# Solana Wallet Toolkit

A pair of Node.js scripts for consolidating SOL and cleaning up token accounts across multiple Solana wallets.

---

## ⚠️ Security Warning

> **These scripts require raw private keys. Never share your private keys with anyone. Never run scripts from untrusted sources with your real keys. Always test on devnet first.**
>
> If you use the companion HTML UI, open it **locally** in your browser — do not host it on a public server. Private keys entered into any web interface should be treated as potentially exposed.

---

## Tools

### 1. `mega_burn.js` — Token Account Closer & SOL Consolidator

Processes multiple source wallets and for each one:

1. **Funds** the source wallet with a small SOL amount (from the destination wallet) to cover transaction fees
2. **Closes token accounts** — transfers tokens above the threshold to the destination, burns tokens at or below the threshold, then closes each account to recover rent (~0.00204 SOL per account)
3. **Closes vacant/uninitialized accounts** to recover any additional rent
4. **Sweeps remaining SOL** to the destination wallet

Supports both the original Token Program and Token-2022.

### 2. `sweeper.js` — SOL Sweeper

Sweeps **all SOL** from multiple wallets to a single destination address, calculating exact fees so each source wallet is left with 0 SOL.

---

## Requirements

- Node.js v16+
- npm

Install dependencies:

```bash
npm install @solana/web3.js @solana/spl-token bs58
```

> `sweeper.js` only requires `@solana/web3.js` and `bs58`.

---

## Configuration

### `mega_burn.js`

Open the file and set the following constants at the top:

| Constant | Description |
|---|---|
| `SOLANA_RPC_URL` | Your RPC endpoint (use devnet for testing) |
| `DESTINATION_ADDRESS` | Base58 public key to receive tokens and SOL |
| `DESTINATION_PRIVATE_KEY` | Base58 private key of the destination wallet (used to fund source wallets) |
| `FUNDING_AMOUNT` | SOL sent to each source wallet before processing (default: `0.002`) |
| `MIN_SOL_TO_KEEP` | SOL left behind in each source wallet after the final sweep (default: `0.001`) |
| `MIN_TOKEN_BALANCE_TO_CLOSE` | Token balance threshold — above this, tokens are **transferred**; at or below, tokens are **burned** (default: `10000`) |
| `PRIVATE_KEYS` | Array of base58-encoded private keys for source wallets |

### `sweeper.js`

| Constant | Description |
|---|---|
| `SOLANA_RPC_URL` | Your RPC endpoint |
| `DESTINATION_ADDRESS` | Base58 public key to receive all SOL |
| `PRIVATE_KEYS` | Array of base58-encoded private keys for wallets to drain |

---

## Usage

### mega_burn.js

```bash
node mega_burn.js
```

**What it does per wallet:**
- Checks if the source wallet needs funding; sends SOL from destination wallet if so
- Iterates all Token Program and Token-2022 token accounts
  - High-balance accounts: transfers tokens to destination, then closes
  - Low-balance accounts: burns tokens, then closes
- Scans for and closes any vacant accounts
- Transfers remaining SOL to the destination (keeping `MIN_SOL_TO_KEEP`)

### sweeper.js

```bash
node sweeper.js
```

**What it does per wallet:**
- Checks current SOL balance
- Calculates exact transaction fee
- Transfers `balance - fee` SOL to the destination
- Verifies the source wallet is at 0 SOL

---

## Devnet Testing

Change `SOLANA_RPC_URL` to:

```
https://api.devnet.solana.com
```

Use the [Solana Faucet](https://faucet.solana.com) to airdrop devnet SOL to test wallets.

---

## Project Structure

```
├── mega_burn.js   # Token account closer & SOL consolidator
├── sweeper.js       # SOL sweeper
├── index.html       # Local browser UI for both tools
└── README.md
```

---

## License

MIT
