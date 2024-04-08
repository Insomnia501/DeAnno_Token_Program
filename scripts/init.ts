import * as anchor from "@coral-xyz/anchor"
import { Program } from "@coral-xyz/anchor"
import { DeAnnoTokenProgram } from "../target/types/de_anno_token_program"
import * as spl from "@solana/spl-token"
import { assert } from "chai"
import { amount, Metaplex } from "@metaplex-foundation/js"
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata"
import * as fs from 'fs';

async function main() {
    anchor.setProvider(anchor.AnchorProvider.env())

    const program = anchor.workspace.DeAnnoTokenProgram as Program<DeAnnoTokenProgram>
    
    const wallet = anchor.workspace.DeAnnoTokenProgram.provider.wallet
    const connection = program.provider.connection
    const metaplex = Metaplex.make(connection)

    const [deannoTokenMintPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("deanno")],
        program.programId
    )
    console.log("deannoTokenMint address:", deannoTokenMintPDA)

    const [deannoDataPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("init")],
        program.programId
    )
    console.log("deannoData address:", deannoDataPDA)

    // token metadata
    const metadata = {
        uri: "https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json",
        name: "DeAnno",
        symbol: "DAN",
    }

    const deannoTokenMintMetadataPDA = await metaplex
        .nfts()
        .pdas()
        .metadata({ mint: deannoTokenMintPDA })

    console.log("deannoTokenMintMetadata address:", deannoTokenMintMetadataPDA)

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
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});