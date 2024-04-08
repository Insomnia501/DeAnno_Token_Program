import * as anchor from "@coral-xyz/anchor"
import { Program } from "@coral-xyz/anchor"
import { DeAnnoTokenProgram } from "../target/types/de_anno_token_program"
import * as spl from "@solana/spl-token"
import { assert } from "chai"
import { amount, Metaplex } from "@metaplex-foundation/js"
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata"
import * as fs from 'fs';

describe("de-anno-token-program", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env())

  const program = anchor.workspace.DeAnnoTokenProgram as Program<DeAnnoTokenProgram>
  const connection = program.provider.connection
  const metaplex = Metaplex.make(connection)
  
  const privateKeyJson = "/Users/daniel/Code/07_Solana/.Solana_wallet/test_wallet_1.json"
  const privateKeyString = fs.readFileSync(privateKeyJson, { encoding: 'utf8' });
  const privateKeyUint8Array = new Uint8Array(JSON.parse(privateKeyString));
  const admin = anchor.web3.Keypair.fromSecretKey(privateKeyUint8Array);

  const worker = anchor.web3.Keypair.generate()
  const demander = anchor.web3.Keypair.generate()
  connection.requestAirdrop(worker.publicKey, 2*anchor.web3.LAMPORTS_PER_SOL)
  connection.requestAirdrop(demander.publicKey, 2*anchor.web3.LAMPORTS_PER_SOL)

  console.log("worker address:", worker.publicKey.toBase58())
  // PDA for the token mint
  const [deannoTokenMintPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("deanno")],
    program.programId
  )

  // PDA for the deanno data account
  const [deannoDataPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("init")],
    program.programId
  )

  // PDA for the worker data account 
  const [workerPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("worker"), worker.publicKey.toBuffer()],
    program.programId
  )
  
  // PDA for the demander data account
  const [demanderPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("demander"), demander.publicKey.toBuffer()],
    program.programId
  )

  // worker associated token account address
  const workerTokenAccount = spl.getAssociatedTokenAddressSync(
    deannoTokenMintPDA,
    worker.publicKey
  )

  // token metadata
  const metadata = {
    uri: "https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json",
    name: "DeAnno",
    symbol: "DAN",
  }

  it("Initialize", async () => {
    // PDA for the token metadata account for the deanno token mint
    const deannoTokenMintMetadataPDA = await metaplex
      .nfts()
      .pdas()
      .metadata({ mint: deannoTokenMintPDA })

    const token_price_init = new anchor.BN(1)
    const withdraw_percent_init = new anchor.BN(50)

    const tx = await program.methods
      .initialize(metadata.uri, metadata.name, metadata.symbol, token_price_init, withdraw_percent_init)
      .accounts({
        deannoTokenMint: deannoTokenMintPDA,
        metadataAccount: deannoTokenMintMetadataPDA,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        initData: deannoDataPDA
      })
      .rpc()
    console.log("Your transaction signature", tx)

    const initData = await program.account.initData.fetch(deannoDataPDA)
    assert.strictEqual(
      Number(
        initData.withdrawPercent
      ),
      50
    )
  })

  it("Init Worker", async () => {
    const withdraw_limit_init = new anchor.BN(100)
    const tx = await program.methods
      .initWorker(withdraw_limit_init)
      .accounts({
        worker: worker.publicKey,
        workerData: workerPDA,
      })
      .signers([worker])
      .rpc()
    console.log("Your transaction signature", tx)

    const workerData = await program.account.workerData.fetch(workerPDA)
    assert.strictEqual(
      Number(
        workerData.withdrawLimit
      ),
      100
    )
  })

  it("Init Demander", async () => {
    const balance_init = new anchor.BN(100)
    const tx = await program.methods
      .initDemander(balance_init)
      .accounts({
        demander: demander.publicKey,
        demanderData: demanderPDA,
      })
      .signers([demander])
      .rpc()
    console.log("Your transaction signature", tx)

    const demanderData = await program.account.demanderData.fetch(demanderPDA)
    assert.strictEqual(
      Number(
        demanderData.balance
      ),
      100
    )
  })

  it("Token Distribution", async () => {
    const amount = new anchor.BN(50)
    const tx = await program.methods
      .tokenDistribution(amount)
      .accounts({
        worker: worker.publicKey,
        demander: demander.publicKey,
        demanderData: demanderPDA,
        workerData: workerPDA,
        initData: deannoDataPDA,
        workerTokenAccount: workerTokenAccount,
        deannoTokenMint: deannoTokenMintPDA,
      })
      .rpc()
    console.log("Your transaction signature", tx)

    // Check that token was minted to the player's token account
    assert.strictEqual(
      Number(
        (await connection.getTokenAccountBalance(workerTokenAccount)).value
          .amount
      ),
      50_000_000_000
    )
  })

  it("worker withdraw", async () => {
    // on localnet test: fake token as USDC
    const usdcTokenMint = await spl.createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      6,
    );

    // program associated token account address
    // the owner is our program but use admin as owner
    const deannoTokenAccount = await spl.createAssociatedTokenAccount(
      connection,
      admin,
      deannoTokenMintPDA,
      admin.publicKey,

    )

    // worker usdc associated token account address
    const workerUSDCAccount = await spl.createAssociatedTokenAccount(
      connection,
      admin,
      usdcTokenMint,
      worker.publicKey
    )

    // program usdc associated token account address
    const deannoUSDCAccount = await spl.createAssociatedTokenAccount(
      connection,
      admin,
      usdcTokenMint,
      admin.publicKey,
    )
    
    // mint some usdc to deannoUSDCAccount for transfer test
    const tx_sign = await spl.mintTo(
      connection,
      admin,
      usdcTokenMint,
      deannoUSDCAccount,
      admin,
      100 * 10 ** 6,
    );
    console.log(
      `Mint Token Transaction: https://explorer.solana.com/tx/${tx_sign}?cluster=devnet`
    )
    
    assert.strictEqual(
      Number(
        (await connection.getTokenAccountBalance(deannoUSDCAccount)).value
          .amount
      ),
      100_000_000
    )
    /*
    const withdraw_amount = new anchor.BN(30)
    const tx = await program.methods
      .workerWithdraw(withdraw_amount)
      .accounts({
        worker: worker.publicKey,
        workerData: workerPDA,
        initData: deannoDataPDA,
        workerTokenAccount: workerTokenAccount,
        workerUsdcAccount: workerUSDCAccount,
        deannoTokenAccount: deannoTokenAccount,
        deannoUsdcAccount: deannoUSDCAccount,
        deannoTokenMint: deannoTokenMintPDA,
        usdcMint: usdcTokenMint
      })
      .rpc().catch(e => console.error(e))
    console.log("Your transaction signature", tx)

    assert.strictEqual(
      Number(
        (await connection.getTokenAccountBalance(workerUSDCAccount)).value
          .amount
      ),
      50_000_000_000
    )
    assert.strictEqual(
      Number(
        (await connection.getTokenAccountBalance(workerTokenAccount)).value
          .amount
      ),
      0
    )
    assert.strictEqual(
      Number(
        (await connection.getTokenAccountBalance(deannoUSDCAccount)).value
          .amount
      ),
      50_000_000
    )
    */
  })
  
})