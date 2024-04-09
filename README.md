# DeAnno_Token_Program
DeAnno - Solana SPL token

## Introduction
The features are as follows:

- Initialization: Initialize our token (DAN) and set up initial parameters.
- Initialize Worker: When a worker logs in for the first time, initialize a Program Derived Address (PDA) to store the worker's personal data.
- Initialize Demander: When a demander logs in for the first time, initialize a PDA to store the demander's personal data.
- Token Distribution: Distribute corresponding token rewards for the work done by the worker.
- Token Exchange: Allow workers to exchange tokens for stablecoins.

## Quickstart

```
// init
yarn
// compile program
anchor build
// use your own ADMIN_PUBKEY in programs/de-anno-token-program/src/lib.rs

/// localnet test
// make a local validator
solana-test-validator -r --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/dep/metadata.so
// deploy to localnet
anchor deploy
// then, replace the program id in programs/de-anno-token-program/src/lib.rs and Anchor.toml by the new program id you get from terminal
// test
anchor test --skip-local-validator 


/// devnet deploy
// update config in Anchor.toml
[provider]
cluster = "Devnet"
// deploy to devnet
anchor deploy
```







