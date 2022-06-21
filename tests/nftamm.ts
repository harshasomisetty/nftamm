import * as anchor from "@project-serum/anchor";
import {Program} from "@project-serum/anchor";
import {Nftamm} from "../target/types/nftamm";
import {PublicKey, LAMPORTS_PER_SOL, Keypair} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMint,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createMint,
  createAccount,
  mintTo,
} from "@solana/spl-token";
import {
  DataV2,
  Collection,
  Uses,
  VerifyCollection,
  CreateMetadataV2,
  CreateMasterEditionV3,
  UpdateMetadataV2,
  SetAndVerifyCollectionCollection,
  Metadata,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  Metaplex,
  bundlrStorage,
  keypairIdentity,
  findMetadataPda,
  TransactionBuilder,
  createCreateMetadataAccountV2InstructionWithSigners,
  createMintAndMintToAssociatedTokenBuilder,
} from "@metaplex-foundation/js";

const fs = require("fs");
const assert = require("assert");
const {SystemProgram, SYSVAR_RENT_PUBKEY} = anchor.web3;

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const connection = provider.connection;
const program = anchor.workspace.Nftamm as Program<Nftamm>;
const programID = new PublicKey(program.idl["metadata"]["address"]);

async function getVaultData(collectionPool: PublicKey, mintKey: PublicKey) {
  let [nftVault] = await PublicKey.findProgramAddress(
    [Buffer.from("nft_vault"), collectionPool.toBuffer(), mintKey.toBuffer()],
    programID
  );

  let [vaultMetadata] = await PublicKey.findProgramAddress(
    [
      Buffer.from("vault_metadata"),
      collectionPool.toBuffer(),
      nftVault.toBuffer(),
    ],
    programID
  );

  return [nftVault, vaultMetadata];
}
describe("nftamm", () => {
  /*
    This test suite will involve 2 users, and consist of:
    1) First init a 2 nfts for 2 collections.
    2) Init the collection pool with parameters
    3) Have each user insert an NFT into the pool
    4) Fail user 1 from inserting an NFT from a wrong collection into this pool
    5) Have user 1 use a redeem token to withdraw an NFT
    6) Have user 1 fail to withdraw another NFT
    7) Verify that the pool still has 1 NFT, and ensure we can retrieve the NFT metadata
  */

  const creator = Keypair.generate();
  const user = [Keypair.generate(), Keypair.generate()];

  const metaplex = Metaplex.make(provider.connection)
    .use(keypairIdentity(creator))
    .use(bundlrStorage());

  let airdropVal = 20 * LAMPORTS_PER_SOL;

  let colBaseSymbol = "NC";
  let colRightSymbol = colBaseSymbol + "0";
  let colWrongSymbol = colBaseSymbol + "1";
  let colCurSymbol = colRightSymbol;
  let nftName = "nft n";

  let collectionPool, collectionBump;
  let redeemMint;

  let mintSize = 2;
  let mintCount = 2;
  let collectionMints: PublicKey[][] = Array(mintCount);
  let userRedeemWallet = Array(mintCount);

  let nftUserTokenAccount;

  it("Init create and mint collections and Metadata", async () => {
    let airdropees = [creator.publicKey, user[0].publicKey, user[1].publicKey];

    console.log("Airdropping...");
    for (const pubkey of airdropees) {
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(pubkey, airdropVal),
        "confirmed"
      );
    }

    console.log("Creating and uploading NFTs...");
    for (let i = 0; i < mintCount; i++) {
      collectionMints[i] = Array(mintSize);

      for (let j = 0; j < mintSize; j++) {
        console.log("loop", i, j);

        let mintKey = await createMint(
          connection,
          creator,
          creator.publicKey,
          creator.publicKey,
          0
        );

        let associatedTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          user[j],
          mintKey,
          user[j].publicKey
        );

        await mintTo(
          connection,
          user[j],
          mintKey,
          associatedTokenAccount.address,
          creator,
          1
        );

        const metadata = findMetadataPda(mintKey);

        let jsonData = {
          symbol: colBaseSymbol + i.toString(),
          name: nftName + j.toString(),
          uri: "https://arweave.net/123",
          description: "description of nft number" + j.toString(),
          creators: [
            {
              address: creator.publicKey,
              share: 100,
              verified: false,
            },
          ],
          sellerFeeBasisPoints: 500,
          collection: null,
          uses: null,
        };

        const tx = TransactionBuilder.make().add(
          createCreateMetadataAccountV2InstructionWithSigners({
            data: jsonData,
            isMutable: false,
            mintAuthority: creator,
            payer: creator,
            mint: mintKey,
            metadata: metadata,
            updateAuthority: creator.publicKey,
          })
        );

        // And send it with confirmation.
        await metaplex.rpc().sendAndConfirmTransaction(tx);

        collectionMints[i][j] = mintKey;
      }
    }

    // Uncomment to print out all nft data.

    // for (let i = 0; i < mintCount; i++) {
    //   for (let j = 0; j < mintSize; j++) {
    //     let mintKey = collectionMints[i][j];
    //     console.log("mint:", collectionMints[i][j].toString());

    //     const nft = await metaplex.nfts().findByMint(mintKey);
    //     console.log("nft data ", nft.metadataAccount.publicKey.toString());

    //     let associatedTokenAccount = await getOrCreateAssociatedTokenAccount(
    //       connection,
    //       user[j],
    //       mintKey,
    //       user[j].publicKey
    //     );

    //     let accountInfo = await getAccount(
    //       connection,
    //       associatedTokenAccount.address
    //     );

    //     console.log("token bal: ", accountInfo.amount);
    //   }
    // }

    const nft = await metaplex.nfts().findByMint(collectionMints[0][0]);
    const metadataData = await Metadata.load(
      connection,
      nft.metadataAccount.publicKey
    );
    // Check basic Collection Pool information.
    assert(metadataData.data.data.symbol === colBaseSymbol + "0");
    assert(metadataData.data.data.name === nftName + "0");
  });

  it("Initialized collection pool!", async () => {
    [collectionPool, collectionBump] = await PublicKey.findProgramAddress(
      [
        Buffer.from("collection_pool"),
        Buffer.from(colCurSymbol),
        creator.publicKey.toBuffer(),
      ],
      programID
    );

    [redeemMint] = await PublicKey.findProgramAddress(
      [Buffer.from("redeem_mint"), collectionPool.toBuffer()],
      programID
    );

    userRedeemWallet[0] = await getAssociatedTokenAddress(
      redeemMint,
      user[0].publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    userRedeemWallet[1] = await getAssociatedTokenAddress(
      redeemMint,
      user[1].publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    nftUserTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      user[0],
      collectionMints[0][0],
      user[0].publicKey
    );

    const tx = await program.methods
      .initializePool(creator.publicKey, colCurSymbol)
      .accounts({
        collectionPool: collectionPool,
        redeemMint: redeemMint,
        creator: creator.publicKey,
        rent: SYSVAR_RENT_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    let collectionPoolInfo = await program.account.collectionPool.fetch(
      collectionPool
    );

    assert.ok(collectionPoolInfo.colSymbol === colCurSymbol);
    assert.ok(
      collectionPoolInfo.colCreator.toString() === creator.publicKey.toString()
    );
  });

  it("Inserted correct nft into corresponding vault!", async () => {
    // Prep accounts for depositing first NFT.
    let mintKey = collectionMints[0][0];

    const nft = await metaplex.nfts().findByMint(mintKey);

    const metadataData = await Metadata.load(
      connection,
      nft.metadataAccount.publicKey
    );

    let [nftVault, vaultMetadata] = await getVaultData(collectionPool, mintKey);

    let tx = await program.methods
      .vaultInsert(creator.publicKey, colCurSymbol, collectionBump)
      .accounts({
        collectionPool: collectionPool,
        redeemMint: redeemMint,
        userRedeemWallet: userRedeemWallet[0],
        nftMint: mintKey,
        nftMetadata: nft.metadataAccount.publicKey,
        nftUserToken: nftUserTokenAccount.address,
        nftVault: nftVault,
        vaultMetadata: vaultMetadata,
        user: user[0].publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user[0]])
      .rpc();

    let postUserRedeemTokenBal = await getAccount(
      provider.connection,
      userRedeemWallet[0]
    );
    assert.ok(Number(postUserRedeemTokenBal.amount) == 1);

    let postUserNftTokenBal = await getAccount(
      provider.connection,
      nftUserTokenAccount.address
    );
    assert.ok(Number(postUserNftTokenBal.amount) == 0);

    let postNftVaultBal = await getAccount(provider.connection, nftVault);
    assert.ok(Number(postNftVaultBal.amount) == 1);

    let collectionPoolInfo = await program.account.collectionPool.fetch(
      collectionPool
    );
    assert.ok(collectionPoolInfo.nftCount == 1);

    // Prepare accounts to deposit second nft.

    let mintKey2 = collectionMints[0][1];

    const nft2 = await metaplex.nfts().findByMint(mintKey2);

    const metadataData2 = await Metadata.load(
      connection,
      nft2.metadataAccount.publicKey
    );

    let nftUserTokenAccount2 = await getOrCreateAssociatedTokenAccount(
      connection,
      user[1],
      mintKey2,
      user[1].publicKey
    );

    let [nftVault2, vaultMetadata2] = await getVaultData(
      collectionPool,
      mintKey2
    );

    tx = await program.methods
      .vaultInsert(creator.publicKey, colCurSymbol, collectionBump)
      .accounts({
        collectionPool: collectionPool,
        redeemMint: redeemMint,
        userRedeemWallet: userRedeemWallet[1],
        nftMint: mintKey2,
        nftMetadata: nft2.metadataAccount.publicKey,
        nftUserToken: nftUserTokenAccount2.address,
        nftVault: nftVault2,
        vaultMetadata: vaultMetadata2,
        user: user[1].publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user[1]])
      .rpc();
  });

  it("Blocked inserting wrong nft into vault!", async () => {
    let mintKey = collectionMints[1][0];

    const nft = await metaplex.nfts().findByMint(mintKey);

    const metadataData = await Metadata.load(
      connection,
      nft.metadataAccount.publicKey
    );

    let [nftVault, vaultMetadata] = await getVaultData(collectionPool, mintKey);

    let err;
    try {
      const tx = await program.methods
        .vaultInsert(creator.publicKey, colCurSymbol, collectionBump)
        .accounts({
          collectionPool: collectionPool,
          redeemMint: redeemMint,
          userRedeemWallet: userRedeemWallet[0],
          nftMint: mintKey,
          nftMetadata: nft.metadataAccount.publicKey,
          nftUserToken: nftUserTokenAccount.address,
          nftVault: nftVault,
          vaultMetadata: vaultMetadata,
          user: user[0].publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user[0]])
        .rpc();
    } catch (error) {
      err = error;
    }

    assert.ok(err.error.origin == "collection_pool");
    assert.ok(err.error.errorCode.code == "ConstraintRaw");
  });

  it("Withdrew from vault!", async () => {
    let mintKey = collectionMints[0][0];

    const nft = await metaplex.nfts().findByMint(mintKey);

    let [nftVault, vaultMetadata] = await getVaultData(collectionPool, mintKey);

    const tx = await program.methods
      .vaultWithdraw(creator.publicKey, colCurSymbol, collectionBump)
      .accounts({
        collectionPool: collectionPool,
        redeemMint: redeemMint,
        user: user[0].publicKey,
        userRedeemWallet: userRedeemWallet[0],
        nftMint: mintKey,
        nftMetadata: nft.metadataAccount.publicKey,
        nftUserToken: nftUserTokenAccount.address,
        nftVault: nftVault,
        vaultMetadata: vaultMetadata,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user[0]])
      .rpc();

    let postUserRedeemTokenBal = await getAccount(
      provider.connection,
      userRedeemWallet[0]
    );
    assert.ok(Number(postUserRedeemTokenBal.amount) == 0);

    let postUserNftTokenBal = await getAccount(
      provider.connection,
      nftUserTokenAccount.address
    );
    assert.ok(Number(postUserNftTokenBal.amount) == 1);

    assert.ok((await connection.getAccountInfo(nftVault)) == null);
  });

  it("Failed withdrawing from vault from lack of redeem tokens!", async () => {
    let mintKey = collectionMints[0][0];

    const nft = await metaplex.nfts().findByMint(mintKey);

    let [nftVault, vaultMetadata] = await getVaultData(collectionPool, mintKey);

    let err;
    try {
      const tx = await program.methods
        .vaultWithdraw(creator.publicKey, colCurSymbol, collectionBump)
        .accounts({
          collectionPool: collectionPool,
          redeemMint: redeemMint,
          user: user[0].publicKey,
          userRedeemWallet: userRedeemWallet[0],
          nftMint: mintKey,
          nftMetadata: nft.metadataAccount.publicKey,
          nftUserToken: nftUserTokenAccount.address,
          nftVault: nftVault,
          vaultMetadata: vaultMetadata,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user[0]])
        .rpc();
    } catch (error) {
      err = error;
    }

    assert.ok(err.error.origin == "nft_vault");
    assert.ok(err.error.errorCode.code == "AccountNotInitialized");
  });

  it("Verified final pool details", async () => {
    // Make sure there is only 1 nft left

    let [nftVault, vaultMetadata] = await getVaultData(
      collectionPool,
      collectionMints[0][0]
    );

    let [nftVault2, vaultMetadata2] = await getVaultData(
      collectionPool,
      collectionMints[0][1]
    );

    let allVaultAccounts = await connection.getTokenAccountsByOwner(
      collectionPool,
      {
        programId: TOKEN_PROGRAM_ID,
      }
    );

    let vaultKeys = [];
    allVaultAccounts.value.forEach((x, i) => vaultKeys.push(x.pubkey));

    let redeemMintInfo = await getMint(connection, redeemMint);

    assert.ok(vaultKeys.length == Number(redeemMintInfo.supply));
    assert.ok(vaultKeys[0].toString() == nftVault2.toString());

    let vaultMetadatas = [];

    for (let vaultKey of vaultKeys) {
      let [tempVaultMetadata] = await PublicKey.findProgramAddress(
        [
          Buffer.from("vault_metadata"),
          collectionPool.toBuffer(),
          vaultKey.toBuffer(),
        ],
        programID
      );

      let vaultInfo = await program.account.vaultMetadata.fetch(
        tempVaultMetadata
      );
      vaultMetadatas.push(vaultInfo.nftMetadata);
    }

    const actualMetadata1 = findMetadataPda(collectionMints[0][0]);
    const actualMetadata2 = findMetadataPda(collectionMints[0][1]);

    assert.ok(vaultMetadatas[0].toString() == actualMetadata2.toString());
  });

  program.provider.connection.onLogs("all", ({logs}) => {
    console.log(logs);
  });
});
