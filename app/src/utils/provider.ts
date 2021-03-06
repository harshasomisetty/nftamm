import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  Program,
  Provider,
  AnchorProvider,
  web3,
  Wallet,
} from "@project-serum/anchor";
const opts = {
  commitment: "confirmed",
  skipPreflight: true,
};

export async function getProvider(wallet: Wallet) {
  /* create the provider and return it to the caller */
  /* network set to local network for now */

  let network_url = "http://localhost:8899";
  // if (network === "localhost") {
  //   network_url = "http://localhost:8899";
  // } else if (network === "devnet") {
  //   network_url = "https://api.devnet.solana.com";
  // }

  const connection = new Connection(network_url, {
    commitment: "confirmed",
  });

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  return provider;
}
