/**
 * Solana Token Account Closer & SOL Consolidator
 *
 * Closes token accounts to recover rent and sends remaining SOL
 * to a destination address.
 *
 * Logic per account:
 *   - balance > MIN_TOKEN_BALANCE_TO_CLOSE  → transfer tokens to destination, then close
 *   - balance <= MIN_TOKEN_BALANCE_TO_CLOSE → burn tokens (if any), then close
 *
 * Requirements:
 * npm install @solana/web3.js @solana/spl-token bs58
 */

const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
} = require('@solana/web3.js');
const {
  closeAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  transfer,
  getOrCreateAssociatedTokenAccount,
  burn,
} = require('@solana/spl-token');
const bs58 = require('bs58');

// ─── Configuration ────────────────────────────────────────────────────────────
const SOLANA_RPC_URL         = 'https://api.mainnet-beta.solana.com';         // e.g. Your RPC URL here (use devnet for testing)
const DESTINATION_ADDRESS    = 'DESTINATION_ADDRESS_HERE';        // Base58 address to receive tokens and SOL
const DESTINATION_PRIVATE_KEY = 'DESTINATION_PRIVATE_KEY_HERE';        // Base58 private key for the destination wallet
const FUNDING_AMOUNT         = 0.002;     // SOL sent to each source wallet to cover fees
const MIN_SOL_TO_KEEP        = 0.001;     // SOL left behind after final sweep

/**
 * Accounts whose token balance is ABOVE this threshold will have their tokens
 * TRANSFERRED to the destination wallet before the account is closed.
 * Accounts AT or BELOW this threshold will have their tokens BURNED.
 * Set to 0 to burn everything.
 */
const MIN_TOKEN_BALANCE_TO_CLOSE = 10000;

// Add your source wallet private keys here (base58 encoded)
const PRIVATE_KEYS = [

'PRIVATE_KEY_1',
'PRIVATE_KEY_2',
];
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAMS = [
  { id: TOKEN_PROGRAM_ID,    name: 'Token Program' },
  { id: TOKEN_2022_PROGRAM_ID, name: 'Token-2022 Program' },
];

// ─── Fund wallet ──────────────────────────────────────────────────────────────
async function fundWallet(connection, funderWallet, targetAddress, amount) {
  try {
    const targetBalance    = await connection.getBalance(targetAddress);
    const targetBalanceSOL = targetBalance / LAMPORTS_PER_SOL;

    console.log(`\n💰 Funding Check:`);
    console.log(`  Target:          ${targetAddress.toBase58()}`);
    console.log(`  Current balance: ${targetBalanceSOL.toFixed(6)} SOL`);
    console.log(`  Needed:          ${amount} SOL`);

    if (targetBalanceSOL >= amount) {
      console.log(`  ✓ Already funded — skipping`);
      return true;
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: funderWallet.publicKey,
        toPubkey:   targetAddress,
        lamports:   Math.round(amount * LAMPORTS_PER_SOL),
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [funderWallet], {
      commitment: 'confirmed',
    });

    console.log(`  ✓ Funded. Signature: ${signature}`);
    await sleep(1000);
    return true;
  } catch (error) {
    console.error(`  ✗ Funding failed: ${error.message}`);
    return false;
  }
}

// ─── Close token accounts ─────────────────────────────────────────────────────
async function closeTokenAccounts(connection, wallet, destinationAddress) {
  console.log(`\nProcessing wallet: ${wallet.publicKey.toBase58()}`);

  const destination = new PublicKey(destinationAddress);
  let totalClosed = 0, totalRent = 0;

  for (const program of PROGRAMS) {
    console.log(`\n📦 Processing ${program.name}...`);

    let accounts;
    try {
      accounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
        programId: program.id,
      });
    } catch (err) {
      console.error(`  Error fetching accounts: ${err.message}`);
      continue;
    }

    console.log(`  Found ${accounts.value.length} account(s)`);
    if (accounts.value.length === 0) continue;

    let closed = 0, rent = 0;

    for (const { pubkey, account } of accounts.value) {
      const info      = account.data.parsed.info;
      const mint      = new PublicKey(info.mint);
      const uiAmount  = info.tokenAmount.uiAmount  || 0;
      const rawAmount = BigInt(info.tokenAmount.amount);

      console.log(`\n  Account: ${pubkey.toBase58()}`);
      console.log(`    Mint:    ${mint.toBase58()}`);
      console.log(`    Balance: ${uiAmount} tokens`);

      try {
        if (rawAmount > 0n) {
          // FIX Bug 1 & 3: high-balance → transfer; low-balance → burn
          const isHighBalance = uiAmount > MIN_TOKEN_BALANCE_TO_CLOSE;

          if (isHighBalance) {
            // ── Transfer tokens to destination ────────────────────────────
            console.log(`    → Balance above threshold — transferring to destination...`);
            try {
              const destTokenAccount = await getOrCreateAssociatedTokenAccount(
                connection,
                wallet,       // payer
                mint,
                destination,
                false,        // allowOwnerOffCurve
                undefined,    // commitment
                undefined,    // confirmOptions
                program.id    // programId — ensures Token-2022 accounts use the right program
              );

              console.log(`    → Destination ATA: ${destTokenAccount.address.toBase58()}`);

              const transferSig = await transfer(
                connection,
                wallet,
                pubkey,
                destTokenAccount.address,
                wallet.publicKey,
                rawAmount,
                undefined,    // multiSigners
                undefined,    // confirmOptions
                program.id    // programId
              );

              console.log(`    ✓ Transferred. Signature: ${transferSig}`);
              await sleep(1000);
            } catch (transferError) {
              console.error(`    ✗ Transfer failed: ${transferError.message}`);
              console.log(`    → Skipping account — tokens not moved, will not close`);
              continue; // FIX Bug 2: don't close if we couldn't empty the account
            }

          } else {
            // ── Burn tokens (balance at or below threshold) ───────────────
            console.log(`    → Balance at or below threshold — burning ${uiAmount} tokens...`);
            try {
              const burnSig = await burn(
                connection,
                wallet,
                pubkey,
                mint,
                wallet.publicKey,
                rawAmount,
                undefined,    // multiSigners
                undefined,    // confirmOptions
                program.id    // programId
              );

              console.log(`    ✓ Burned. Signature: ${burnSig}`);
              await sleep(1000);
            } catch (burnError) {
              console.error(`    ✗ Burn failed: ${burnError.message}`);
              console.log(`    → Skipping account — tokens not burned, will not close`);
              continue; // FIX Bug 2: don't close if we couldn't empty the account
            }
          }
        }

        // ── Close the now-empty account to recover rent ──────────────────
        console.log(`    → Closing account to recover rent...`);
        const closeSig = await closeAccount(
          connection,
          wallet,
          pubkey,
          wallet.publicKey, // rent destination (sweep to source wallet; transferred to dest later)
          wallet,
          undefined,
          undefined,
          program.id        // programId — FIX Bug 4: always pass correct program
        );

        console.log(`    ✓ Closed. Signature: ${closeSig}`);
        closed++;
        rent += 0.00203928;

      } catch (error) {
        console.error(`    ✗ Failed to process account: ${error.message}`);
      }
    }

    if (closed > 0) {
      console.log(`\n  📊 ${program.name}: ${closed} closed, ~${rent.toFixed(6)} SOL recovered`);
    }
    totalClosed += closed;
    totalRent   += rent;
  }

  if (totalClosed > 0) {
    console.log(`\n📊 Token accounts total: ${totalClosed} closed, ~${totalRent.toFixed(6)} SOL recovered`);
  }
  return totalRent;
}

// ─── Close vacant / uninitialized accounts ────────────────────────────────────
async function closeVacantAccounts(connection, wallet) {
  console.log(`\n🔍 Scanning for vacant accounts...`);

  let totalClosed = 0, totalRent = 0;

  for (const program of PROGRAMS) {
    console.log(`\n  Checking ${program.name}...`);

    let accounts;
    try {
      accounts = await connection.getParsedProgramAccounts(program.id, {
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 32, bytes: wallet.publicKey.toBase58() } },
        ],
      });
    } catch (err) {
      console.error(`  Error scanning ${program.name}: ${err.message}`);
      continue;
    }

    console.log(`  Found ${accounts.length} account(s) in ${program.name}`);

    let closed = 0, rent = 0;

    for (const { pubkey } of accounts) {
      try {
        const info = await connection.getParsedAccountInfo(pubkey);
        if (info.value && info.value.data) continue; // has data — not vacant

        console.log(`\n    Vacant: ${pubkey.toBase58()}`);
        const sig = await closeAccount(
          connection,
          wallet,
          pubkey,
          wallet.publicKey,
          wallet,
          undefined,
          undefined,
          program.id
        );
        console.log(`    ✓ Closed. Signature: ${sig}`);
        closed++;
        rent += 0.00203928;
      } catch (err) {
        console.log(`    → Cannot close: ${err.message}`);
      }
    }

    if (closed > 0) {
      console.log(`\n  ${program.name}: ${closed} vacant accounts closed, ~${rent.toFixed(6)} SOL recovered`);
    }
    totalClosed += closed;
    totalRent   += rent;
  }

  if (totalClosed === 0) console.log(`  ✓ No vacant accounts found`);
  return totalRent;
}

// ─── Transfer remaining SOL to destination ────────────────────────────────────
async function transferRemainingSOL(connection, wallet, destinationAddress) {
  const balance       = await connection.getBalance(wallet.publicKey);
  const balanceInSOL  = balance / LAMPORTS_PER_SOL;

  console.log(`\n  SOL balance: ${balanceInSOL.toFixed(6)} SOL`);

  if (balanceInSOL <= MIN_SOL_TO_KEEP) {
    console.log(`  Balance too low to transfer (keeping ${MIN_SOL_TO_KEEP} SOL minimum)`);
    return;
  }

  const { blockhash } = await connection.getLatestBlockhash();
  const testTx = new Transaction({ recentBlockhash: blockhash, feePayer: wallet.publicKey }).add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey:   new PublicKey(destinationAddress),
      lamports:   balance - Math.round(MIN_SOL_TO_KEEP * LAMPORTS_PER_SOL),
    })
  );

  const fee         = await connection.getFeeForMessage(testTx.compileMessage(), 'confirmed');
  const amountToSend = balance - fee.value - Math.round(MIN_SOL_TO_KEEP * LAMPORTS_PER_SOL);

  if (amountToSend <= 0) {
    console.log(`  Not enough SOL to cover fees`);
    return;
  }

  console.log(`  Sending ${(amountToSend / LAMPORTS_PER_SOL).toFixed(6)} SOL → ${destinationAddress}`);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey:   new PublicKey(destinationAddress),
      lamports:   amountToSend,
    })
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [wallet], {
    commitment: 'confirmed',
  });

  console.log(`  ✓ SOL transferred. Signature: ${signature}`);
}

// ─── Process one wallet ───────────────────────────────────────────────────────
async function processWallet(connection, privateKey, destinationAddress, funderWallet) {
  let wallet;
  try {
    wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch (err) {
    console.error(`\n✗ Invalid private key — skipping: ${err.message}`);
    return;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log('='.repeat(80));

  // Step 0: fund if needed
  if (funderWallet) {
    const funded = await fundWallet(connection, funderWallet, wallet.publicKey, FUNDING_AMOUNT);
    if (!funded) console.log('⚠️  Funding failed — continuing anyway');
  }

  // Step 1: close token accounts (burn low-balance, transfer high-balance)
  await closeTokenAccounts(connection, wallet, destinationAddress);
  await sleep(1000);

  // Step 2: close vacant accounts
  await closeVacantAccounts(connection, wallet);
  await sleep(2000);

  // Step 3: sweep remaining SOL
  await transferRemainingSOL(connection, wallet, destinationAddress);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Solana Token Account Closer & SOL Consolidator');
  console.log('='.repeat(80));

  if (!DESTINATION_ADDRESS || DESTINATION_ADDRESS === 'YOUR_DESTINATION_ADDRESS_HERE') {
    console.error('❌ Set DESTINATION_ADDRESS'); process.exit(1);
  }
  if (!DESTINATION_PRIVATE_KEY || DESTINATION_PRIVATE_KEY === 'YOUR_DESTINATION_PRIVATE_KEY_HERE') {
    console.error('❌ Set DESTINATION_PRIVATE_KEY'); process.exit(1);
  }
  if (!PRIVATE_KEYS.length || PRIVATE_KEYS[0] === 'YOUR_PRIVATE_KEY') {
    console.error('❌ Add private keys to PRIVATE_KEYS'); process.exit(1);
  }

  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

  // Validate funder wallet
  let funderWallet;
  try {
    funderWallet = Keypair.fromSecretKey(bs58.decode(DESTINATION_PRIVATE_KEY));

    if (funderWallet.publicKey.toBase58() !== DESTINATION_ADDRESS) {
      console.error('❌ DESTINATION_PRIVATE_KEY does not match DESTINATION_ADDRESS');
      console.error(`  Key resolves to: ${funderWallet.publicKey.toBase58()}`);
      process.exit(1);
    }

    const funderBalance    = await connection.getBalance(funderWallet.publicKey);
    const funderBalanceSOL = funderBalance / LAMPORTS_PER_SOL;
    const totalNeeded      = FUNDING_AMOUNT * PRIVATE_KEYS.length;

    console.log(`\nFunder wallet: ${funderWallet.publicKey.toBase58()}`);
    console.log(`Balance:       ${funderBalanceSOL.toFixed(6)} SOL`);
    if (funderBalanceSOL < totalNeeded) {
      console.warn(`⚠️  May not have enough SOL — need ~${totalNeeded.toFixed(6)}, have ${funderBalanceSOL.toFixed(6)}`);
    }
  } catch (err) {
    console.error(`❌ Funder wallet error: ${err.message}`); process.exit(1);
  }

  console.log(`\nRPC:              ${SOLANA_RPC_URL}`);
  console.log(`Destination:      ${DESTINATION_ADDRESS}`);
  console.log(`Wallets:          ${PRIVATE_KEYS.length}`);
  console.log(`Funding per wallet: ${FUNDING_AMOUNT} SOL`);
  console.log(`Transfer threshold: ${MIN_TOKEN_BALANCE_TO_CLOSE} tokens`);
  console.log(`  > threshold → transfer to destination`);
  console.log(`  ≤ threshold → burn and recover rent\n`);

  for (const privateKey of PRIVATE_KEYS) {
    await processWallet(connection, privateKey, DESTINATION_ADDRESS, funderWallet);
    await sleep(1000);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✓ All wallets processed');
  console.log('='.repeat(80));
}

main().catch(console.error);
