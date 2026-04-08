/**
 * Solana SOL Sweeper
 * 
 * This script transfers ALL SOL from multiple wallets to a single destination,
 * leaving 0 SOL in each wallet.
 * 
 * Requirements:
 * npm install @solana/web3.js bs58
 */

const { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram
} = require('@solana/web3.js');
const bs58 = require('bs58');

// Configuration
const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com'; // Change to devnet for testing
const DESTINATION_ADDRESS = 'DESTINATION_ADDRESS_HERE'; // Change to your destination address

// Add your private keys here (base58 encoded) 
const PRIVATE_KEYS = [
'PRIVATE_KEY_1',
'PRIVATE_KEY_2',
];

async function sweepWallet(connection, wallet, destinationAddress) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Sweeping Wallet: ${wallet.publicKey.toBase58()}`);
  console.log('='.repeat(80));

  try {
    // Get current balance
    const balance = await connection.getBalance(wallet.publicKey);
    const balanceInSOL = balance / LAMPORTS_PER_SOL;
    
    console.log(`Current balance: ${balanceInSOL.toFixed(9)} SOL (${balance} lamports)`);

    if (balance === 0) {
      console.log('⚠️  Wallet is already empty, skipping...');
      return 0;
    }

    // Get recent blockhash for fee estimation
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    // Create a test transaction to calculate the exact fee
    const testTransaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: wallet.publicKey
    }).add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(destinationAddress),
        lamports: balance // We'll adjust this
      })
    );

    // Get the fee for this transaction
    const feeCalculator = await connection.getFeeForMessage(
      testTransaction.compileMessage(),
      'confirmed'
    );

    const fee = feeCalculator.value;
    console.log(`Transaction fee: ${(fee / LAMPORTS_PER_SOL).toFixed(9)} SOL (${fee} lamports)`);

    // Calculate the exact amount to send (balance - fee)
    const amountToSend = balance - fee;

    if (amountToSend <= 0) {
      console.log('❌ Balance is not enough to cover the transaction fee');
      console.log(`   Need at least ${(fee / LAMPORTS_PER_SOL).toFixed(9)} SOL for fees`);
      return 0;
    }

    console.log(`Amount to send: ${(amountToSend / LAMPORTS_PER_SOL).toFixed(9)} SOL (${amountToSend} lamports)`);
    console.log(`Remaining after: 0 SOL`);
    console.log(`\n→ Sending to ${destinationAddress}...`);

    // Create the actual transaction with the correct amount
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: wallet.publicKey
    }).add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(destinationAddress),
        lamports: amountToSend
      })
    );

    // Send and confirm the transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet],
      { 
        commitment: 'confirmed',
        preflightCommitment: 'confirmed'
      }
    );

    console.log(`✓ Transfer complete!`);
    console.log(`  Signature: ${signature}`);
    console.log(`  Sent: ${(amountToSend / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log(`  Fee paid: ${(fee / LAMPORTS_PER_SOL).toFixed(9)} SOL`);

    // Verify the wallet is empty
    await new Promise(resolve => setTimeout(resolve, 1000));
    const newBalance = await connection.getBalance(wallet.publicKey);
    console.log(`  Final balance: ${(newBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);

    if (newBalance === 0) {
      console.log(`  ✓ Wallet successfully emptied!`);
    } else {
      console.log(`  ⚠️  Warning: ${(newBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL remaining`);
    }

    return amountToSend;

  } catch (error) {
    console.error(`❌ Error sweeping wallet: ${error.message}`);
    return 0;
  }
}

async function main() {
  console.log('Solana SOL Sweeper');
  console.log('='.repeat(80));
  console.log('⚠️  WARNING: This script will drain ALL SOL from wallets to 0!');
  console.log('='.repeat(80));

  if (!DESTINATION_ADDRESS || DESTINATION_ADDRESS === 'YOUR_DESTINATION_ADDRESS_HERE') {
    console.error('\n❌ Error: Please set DESTINATION_ADDRESS in the script');
    process.exit(1);
  }

  if (PRIVATE_KEYS.length === 0 || PRIVATE_KEYS[0] === 'YOUR_PRIVATE_KEY_1') {
    console.error('\n❌ Error: Please add private keys to the PRIVATE_KEYS array');
    process.exit(1);
  }

  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

  console.log(`\nRPC Endpoint: ${SOLANA_RPC_URL}`);
  console.log(`Destination: ${DESTINATION_ADDRESS}`);
  console.log(`Wallets to sweep: ${PRIVATE_KEYS.length}\n`);

  let totalSwept = 0;
  let successfulSweeps = 0;
  const results = [];

  for (let i = 0; i < PRIVATE_KEYS.length; i++) {
    const privateKey = PRIVATE_KEYS[i];
    
    try {
      console.log(`\nProcessing wallet ${i + 1} of ${PRIVATE_KEYS.length}...`);
      
      // Decode private key
      const secretKey = bs58.decode(privateKey);
      const wallet = Keypair.fromSecretKey(secretKey);

      // Sweep the wallet
      const amountSwept = await sweepWallet(connection, wallet, DESTINATION_ADDRESS);
      
      if (amountSwept > 0) {
        totalSwept += amountSwept;
        successfulSweeps++;
        results.push({
          address: wallet.publicKey.toBase58(),
          amount: amountSwept,
          success: true
        });
      } else {
        results.push({
          address: wallet.publicKey.toBase58(),
          amount: 0,
          success: false
        });
      }

      // Add delay between wallets to avoid rate limits
      if (i < PRIVATE_KEYS.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } catch (error) {
      console.error(`\n❌ Error processing wallet ${i + 1}: ${error.message}`);
      results.push({
        address: 'Unknown',
        amount: 0,
        success: false,
        error: error.message
      });
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('SWEEP SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets processed: ${PRIVATE_KEYS.length}`);
  console.log(`Successful sweeps: ${successfulSweeps}`);
  console.log(`Failed/Empty wallets: ${PRIVATE_KEYS.length - successfulSweeps}`);
  console.log(`Total SOL swept: ${(totalSwept / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
  console.log('='.repeat(80));

  // Detailed results
  console.log('\nDETAILED RESULTS:');
  console.log('-'.repeat(80));
  results.forEach((result, index) => {
    const status = result.success ? '✓' : '✗';
    const amount = (result.amount / LAMPORTS_PER_SOL).toFixed(9);
    console.log(`${status} Wallet ${index + 1}: ${result.address}`);
    if (result.success) {
      console.log(`   Swept: ${amount} SOL`);
    } else if (result.error) {
      console.log(`   Error: ${result.error}`);
    } else {
      console.log(`   Empty or failed`);
    }
  });
  console.log('-'.repeat(80));

  console.log('\n✓ Sweep complete!');
}

// Run the script
main().catch(console.error);