import { arrayify } from "@ethersproject/bytes";
import { keccak256 } from "@ethersproject/keccak256";
import { serialize } from "@ethersproject/transactions";

/// Computes the transaction message that will be signed.
export const getMessage = transaction => {
  return keccak256(arrayify(serialize(transaction)));
};

/// Broadcasts a serialized signed transaction
export const sendSignedTransaction = async (signedTransaction, provider) => {
  return await provider.sendTransaction(signedTransaction);
};
