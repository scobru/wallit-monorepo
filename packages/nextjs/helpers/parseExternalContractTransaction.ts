import axios from "axios";
import { ethers } from "ethers";

export default async function parseExternalContractTransaction(contractAddress, txData) {
  try {
    const response = await axios.get("https://api.polygonscan.com/", {
      params: {
        module: "contract",
        action: "getabi",
        address: contractAddress,
        apikey: "AD65CT8WN7AWPCJASIVKBZJ2PRKMNE85FB",
      },
    });

    const getParsedTransaction = async () => {
      const abi = response?.data?.result;
      if (abi && txData && txData !== "") {
        const iface = new ethers.utils.Interface(JSON.parse(abi));
        return iface.parseTransaction({ data: txData });
      }
    };

    return await getParsedTransaction(response);
  } catch (error) {
    console.log("parseExternalContractTransaction error:", error);
  }
}
