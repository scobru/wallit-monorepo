import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import { useRouter } from "next/router";
import { useScaffoldContractRead, useTransactor } from "../hooks/scaffold-eth";
import { useScaffoldContractWrite } from "../hooks/scaffold-eth";
import UniswapIcon from "../uniswap.png";
import { addresses } from "../utils/constant";
import { MaxUint256 } from "@ethersproject/constants";
import { ProviderType } from "@lit-protocol/constants";
import {
  DiscordProvider,
  EthWalletProvider,
  GoogleProvider,
  LitAuthClient,
  WebAuthnProvider,
  getProviderFromUrl,
  isSignInRedirect,
} from "@lit-protocol/lit-auth-client";
import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { AuthMethod, AuthSig, IRelayPKP, SessionSigs } from "@lit-protocol/types";
import "@uniswap/widgets/fonts.css";
import { multicall } from "@wagmi/core";
import { P } from "@wagmi/core/dist/index-35b6525c";
import { Contract, ethers } from "ethers";
import {
  Interface,
  computePublicKey,
  joinSignature,
  parseEther,
  parseUnits,
  recoverAddress,
  recoverPublicKey,
  verifyMessage,
} from "ethers/lib/utils.js";
import { NextPage } from "next";
import { QRCodeCanvas } from "qrcode.react";
import { MetaMaskAvatar } from "react-metamask-avatar";
import {
  Connector,
  useAccount,
  useBlockNumber,
  useContractWrite,
  useDisconnect,
  usePrepareContractWrite,
  useProvider,
  useSigner,
} from "wagmi";
import { erc20ABI } from "wagmi";
import {
  ArchiveBoxIcon,
  ArrowDownCircleIcon,
  ArrowPathIcon,
  ArrowRightCircleIcon,
  ArrowUpCircleIcon,
  ArrowsRightLeftIcon,
} from "@heroicons/react/24/outline";
import { Address } from "~~/components/scaffold-eth";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

// Local dev only: When using npm link, need to update encryption pkg to handle possible ipfs client init error
// let ipfsClient = null;
// try {
//   ipfsClient = require("ipfs-http-client");
// } catch {}

enum Views {
  SIGN_IN = "sign_in",
  HANDLE_REDIRECT = "handle_redirect",
  REQUEST_AUTHSIG = "request_authsig",
  REGISTERING = "webauthn_registering",
  REGISTERED = "webauthn_registered",
  AUTHENTICATING = "webauthn_authenticating",
  FETCHING = "fetching",
  FETCHED = "fetched",
  MINTING = "minting",
  MINTED = "minted",
  CREATING_SESSION = "creating_session",
  SESSION_CREATED = "session_created",
  ERROR = "error",
  DECRYPT = "decrypt",
}

const Home: NextPage = () => {
  const redirectUri = "https://localhost:3000/wallet";
  const { data: signer } = useSigner();
  const account = useAccount();
  const signerAddress = account?.address;
  const provider = useProvider();
  const router = useRouter();
  const chainName = "polygon";
  const txData = useTransactor();
  const block = useBlockNumber();

  const { data: wallitCtx } = useDeployedContractInfo("Wallit");

  const { writeAsync: createWallit } = useScaffoldContractWrite({
    contractName: "Factory",
    functionName: "createWallit",
  });

  const { data: yourWallit } = useScaffoldContractRead({
    contractName: "Factory",
    functionName: "getWallit",
    args: [signerAddress],
  });

  const [view, setView] = useState<Views>(Views.SIGN_IN);
  const [error, setError] = useState<any>();
  const [litAuthClient, setLitAuthClient] = useState<LitAuthClient>();
  const [litNodeClient, setLitNodeClient] = useState<LitNodeClient>();
  const [currentProviderType, setCurrentProviderType] = useState<ProviderType>();
  const [authMethod, setAuthMethod] = useState<AuthMethod>();
  const [pkps, setPKPs] = useState<IRelayPKP[]>([]);
  const [currentPKP, setCurrentPKP] = useState<IRelayPKP>();
  const [sessionSigs, setSessionSigs] = useState<SessionSigs>();
  const [, setAuthSig] = useState<AuthSig>();
  const [message, setMessage] = useState<string>("Free the web!");
  const [signature, setSignature] = useState<string>();
  const [recoveredAddress, setRecoveredAddress] = useState<string>();
  const [verified, setVerified] = useState<boolean>(false);
  const [targetAddress, setTargetAddress] = useState<string>("");
  const [amountToSend, setAmountToSend] = useState<string>("0");
  const [tokenToApprove, setTokenToApprove] = useState<string>("0");
  const [customTx, setCustomTx] = useState("");
  const [wallitName, setWallitName] = useState("");
  const [wallitDescription, setWallitDescription] = useState("");
  const [balance, setBalance] = useState<string>();
  const [tokenFrom, setTokenFrom] = useState<string>();
  const [tokenTo, setTokenTo] = useState<string>();
  const [amountToSwap, setAmountToSwap] = useState<string>();
  const [tokenList, setTokenList] = useState<string[]>([]);
  const [tokenInWallet, setTokenInWallet] = useState<string[]>([]);
  const zapperUrl = "https://zapper.xyz/account/" + currentPKP?.ethAddress;
  const qrCodeUrl = "ethereum:" + currentPKP?.ethAddress + "/pay?chain_id=137value=0";

  const executeSetWallitNamePrepared = usePrepareContractWrite({
    address: String(yourWallit),
    abi: wallitCtx?.abi,
    functionName: "setName",
    args: [wallitName, String(currentPKP?.ethAddress)],
  });

  const executeSetWallitName = useContractWrite(executeSetWallitNamePrepared.config);

  useEffect(() => {
    if (wallitCtx && yourWallit != "0x0000000000000000000000000000000000000000" && signer && currentPKP?.ethAddress) {
      const contract = new ethers.Contract(String(yourWallit), wallitCtx?.abi, signer || provider);
      // fetch ETH amount of an address with ethers
      const getBalance = async () => {
        const balance = await provider.getBalance(currentPKP?.ethAddress);
        setBalance(ethers.utils.formatEther(balance));
      };
      getBalance();

      const getWallitNames = async () => {
        const name = await contract.getNames(currentPKP?.ethAddress);

        setWallitDescription(name);
      };
      getWallitNames();
    } else {
      setWallitDescription("");
    }
  }, [block, signer, provider, wallitCtx, currentPKP?.ethAddress, balance]);

  // Use wagmi to connect one's eth wallet
  /* const { connectAsync } = useConnect({
    onError(error) {
      console.error(error);
      setError(error);
    },
  }); */

  const { isConnected, connector, address } = useAccount();
  const { disconnectAsync } = useDisconnect();

  async function fetchTokenList() {
    console.log("Fetch Token List");
    const response = await fetch("https://gateway.ipfs.io/ipns/tokens.uniswap.org");
    const tokenListJSON = await response.json();
    // filter tokenlist for chainId params
    const tokens = tokenListJSON.tokens.filter((token: { chainId: number }) => token.chainId == 137);
    setTokenList(tokens);
    console.log("Token List", tokens);
  }

  async function fetchTokenInWallet() {
    if (tokenList.length > 0) {
      const id = notification.loading("Fetching Token In Wallet, Please Wait...");

      const _tokens = [];

      const _contractList = [];

      for (let i = 0; i < tokenList.length; i++) {
        _contractList.push({
          address: tokenList[i].address,
          abi: erc20ABI,
        });
      }

      for (let i = 0; i < tokenList.length; i++) {
        const data = await multicall({
          contracts: [
            {
              ..._contractList[i],
              functionName: "balanceOf",
              args: [currentPKP?.ethAddress],
              chainId: 137,
            },
          ],
        });

        if (Number(data) > 0) {
          _tokens.push({ ...tokenList[i], balance: data });
        }
      }

      if (_tokens.length > 0) {
        notification.remove(id);
        notification.success("Token In Wallet Fetched");
      } else {
        notification.remove(id);
        notification.error("No Token In Wallet");
      }

      setTokenInWallet(_tokens);
      console.log("Token In Wallet", _tokens);
    }
  }

  useEffect(() => {
    fetchTokenList();
    fetchTokenInWallet();
  }, []);

  async function processTransaction(tx: {
    to: any;
    nonce: number | undefined;
    value: ethers.BigNumberish | undefined;
    gasPrice: ethers.BigNumberish | undefined;
    gasLimit: ethers.BigNumberish | undefined;
    chainId: number | undefined;
    data: ethers.utils.BytesLike | undefined;
    type?: number | null | undefined;
    accessList?: ethers.utils.AccessListish | undefined;
    maxPriorityFeePerGas?: ethers.BigNumberish | undefined;
    maxFeePerGas?: ethers.BigNumberish | undefined;
  }) {
    const serializedTx = ethers.utils.serializeTransaction(await tx);
    const toSign = ethers.utils.arrayify(ethers.utils.keccak256(await serializedTx));
    const message = serializedTx;
    let id = notification.info("Create Signature");

    const litActionCode = `
        const go = async () => {
          // this requests a signature share from the Lit Node
          // the signature share will be automatically returned in the response from the node
          // and combined into a full signature by the LitJsSdk for you to use on the client
          // all the params (toSign, publicKey, sigName) are passed in from the LitJsSdk.executeJs() function
          const sigShare = await LitActions.signEcdsa({ toSign, publicKey, sigName });
        };
        go();
      `;

    // Sign message
    // @ts-ignore - complains about no authSig, but we don't need one for this action
    const results = await litNodeClient.executeJs({
      code: litActionCode,
      sessionSigs: sessionSigs,
      jsParams: {
        toSign: toSign,
        publicKey: currentPKP?.publicKey,
        sigName: "sig1",
      },
    });

    // Get signature
    const result = results.signatures["sig1"];
    console.log("result", result);

    // Split the signature object
    const dataSigned = toSign;
    console.log("dataSigned", dataSigned);

    const encodedSig = joinSignature({
      r: "0x" + result.r,
      s: "0x" + result.s,
      v: result.recid,
    });

    // const encodedSplitSig = splitSignature({
    //   r: "0x" + result.r,
    //   s: "0x" + result.s,
    //   v: result.recid,
    // });

    setSignature(encodedSig);
    console.log("signature", encodedSig);

    notification.remove(id);
    id = notification.info("Verify signature");

    const recoveredPubkey = recoverPublicKey(dataSigned, encodedSig);
    console.log("uncompressed recoveredPubkey", recoveredPubkey);

    const compressedRecoveredPubkey = computePublicKey(recoveredPubkey, true);
    console.log("compressed recoveredPubkey", compressedRecoveredPubkey);

    const recoveredAddress = recoverAddress(dataSigned, encodedSig);
    console.log("recoveredAddress", recoveredAddress);

    const recoveredAddressViaMessage = verifyMessage(message, encodedSig);
    console.log("recoveredAddressViaMessage", recoveredAddressViaMessage);

    // Get the address associated with the signature created by signing the message
    const recoveredAddr = recoveredAddress;
    console.log("recoveredAddr", recoveredAddr);
    setRecoveredAddress(recoveredAddr);

    // Check if the address associated with the signature is the same as the current PKP
    const verified = currentPKP?.ethAddress.toLowerCase() === recoveredAddr.toLowerCase();
    console.log("verified", verified);
    setVerified(verified);

    notification.remove(id);
    id = notification.info("Send transaction");

    const signedTransaction = ethers.utils.serializeTransaction(tx, encodedSig);
    console.log("signedTransaction", signedTransaction);

    const txSend = await sendSignedTransaction(signedTransaction, provider);
    notification.remove(id);

    id = notification.loading("Waiting for transaction to be mined");

    // Wait for the transaction to be mined
    while (true) {
      const receipt = await provider.getTransactionReceipt(txSend.hash);
      if (receipt) {
        break;
      }
    }

    txSend
      .wait()
      .then((receipt: any) => {
        console.log("receipt", receipt);
        notification.remove(id);
        id = notification.success("Transaction Successful");
      })
      .catch((error: any) => {
        console.log("error", error);
        notification.remove(id);

        id = notification.remove(id);

        notification.error("Transaction Failed");
      });
  }

  const sendSignedTransaction = async (
    signedTransaction: number | ethers.utils.BytesLike | ethers.utils.Hexable,
    provider: P,
  ) => {
    const bytes: any = ethers.utils.arrayify(signedTransaction);
    const tx = await provider.sendTransaction(bytes);

    return tx;
  };

  async function sendCustomTxWithPKP() {
    const id = notification.info("Send Custom Transaction");

    const tx = {
      to: targetAddress,
      nonce: await provider.getTransactionCount(currentPKP?.ethAddress as string),
      value: parseEther(amountToSend),
      gasPrice: await provider.getGasPrice(),
      gasLimit: 5000000,
      chainId: (await provider.getNetwork()).chainId,
      data: "0x" + customTx,
    };

    notification.remove(id);
    await processTransaction(tx);
  }

  // Swap Functions

  async function generateSwapExactInputSingleCalldata(exactInputSingleData: {
    tokenIn: any;
    tokenOut: any;
    fee: any;
    recipient: any;
    amountIn: any;
    amountOutMinimum: any;
    sqrtPriceLimitX96: any;
  }) {
    const iface = new Interface([
      "function exactInputSingle(tuple(address,address,uint24,address,uint256,uint256,uint160)) external payable returns (uint256)",
    ]);
    return iface.encodeFunctionData("exactInputSingle", [
      [
        exactInputSingleData.tokenIn,
        exactInputSingleData.tokenOut,
        exactInputSingleData.fee,
        exactInputSingleData.recipient,
        exactInputSingleData.amountIn,
        exactInputSingleData.amountOutMinimum,
        exactInputSingleData.sqrtPriceLimitX96,
      ],
    ]);
  }

  async function executeUniswapV3SwapExactInputSingle(
    swapRouterAddress: any,
    exactInputSingleParams: {
      tokenIn: any;
      tokenOut: any;
      fee: any;
      recipient: any;
      amountIn: any;
      amountOutMinimum: any;
      sqrtPriceLimitX96: any;
    },
  ) {
    const id = notification.info("Execute Swap");
    console.log(generateSwapExactInputSingleCalldata(exactInputSingleParams));

    const tx = {
      to: swapRouterAddress,
      nonce: await provider.getTransactionCount(currentPKP?.ethAddress as string),
      value: 0,
      gasPrice: await provider.getGasPrice(),
      gasLimit: 0,
      chainId: (await provider.getNetwork()).chainId,
      data: await generateSwapExactInputSingleCalldata(exactInputSingleParams),
    };
    tx.gasLimit =
      Number(await provider.estimateGas(await generateSwapExactInputSingleCalldata(exactInputSingleParams))) + 100000;

    console.log(tx);
    notification.remove(id);
    await processTransaction(tx);
  }

  const getAllowance = async (
    tokenAddress: string,
    owner: any,
    spender: string,
    provider: ethers.Signer | ethers.providers.Provider | undefined,
  ) => {
    const abi = ["function allowance(address,address) view returns (uint256)"];

    const contract = new Contract(tokenAddress, abi, provider);
    return await contract.allowance(owner, spender);
  };

  async function approveERC20WithPKP() {
    const id = notification.info("Approving ERC20 Token");

    const iface = new Interface(["function approve(address,uint256) returns (bool)"]);
    const data = iface.encodeFunctionData("approve", [targetAddress, parseEther(amountToSend)]);

    console.log("data", data);

    const tx = {
      to: tokenToApprove,
      nonce: await provider.getTransactionCount(currentPKP?.ethAddress as string),
      value: 0,
      gasPrice: await provider.getGasPrice(),
      gasLimit: 500000,
      chainId: (await provider?.getNetwork()).chainId,
      data: data,
    };

    console.log("tx", tx);

    console.log("Approve Tx Created");

    notification.remove(id);
    await processTransaction(tx);
  }

  const swapUniswapExactInputSingle = async () => {
    console.log("[Wallit]: getting uniswap allowance...");

    const allowance = await getAllowance(
      tokenFrom!, // cEUR
      currentPKP?.ethAddress, // owner
      addresses.polygon.uniswap.v3.SwapRouter02, // spender
      provider,
    );

    if (allowance.eq(0)) {
      console.log("[Wallit]: approving maximum allowance for swap...");
      setTokenToApprove(tokenFrom!);
      setAmountToSend(String(MaxUint256));
      setTargetAddress(addresses.polygon.uniswap.v3.SwapRouter02);

      console.log("[Wallit]: approving uniswap...");
      console.log("Token From", tokenFrom);
      console.log("Token To", tokenTo);
      console.log("Amount To Swap", amountToSend);
      console.log("Target Address", targetAddress);

      await approveERC20WithPKP();
    } else {
      console.log("[Wallit]: uniswap already approved...");
    }

    // fech block timestamp ethers

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    console.log("Token From", tokenFrom);
    console.log("Token To", tokenTo);

    const swapDescriptionUni = {
      tokenIn: tokenFrom,
      tokenOut: tokenTo,
      recipient: currentPKP?.ethAddress,
      deadline: deadline + 1000,
      amountIn: parseEther(String(amountToSwap)),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
      fee: 500,
    };

    console.log("[testSDK]: executing trade on celo uniswap...");
    await executeUniswapV3SwapExactInputSingle(addresses.polygon.uniswap.v3.SwapRouter02, swapDescriptionUni);
    console.log("[testSDK]: sent swap transaction... ");
  };

  // Send ETH with PKP

  async function wrapETHWithPKP() {
    const id = notification.info("Wrap ETH with PKP");
    console.log("Current PKP", currentPKP);
    const iface = new Interface(["function deposit()"]);
    const data = iface.encodeFunctionData("deposit", []);

    const tx = {
      to: addresses.polygon.wmatic, // spender,
      nonce: await provider.getTransactionCount(currentPKP?.ethAddress as string),
      value: parseEther(amountToSend),
      gasPrice: await provider.getGasPrice(),
      gasLimit: 0,
      chainId: (await provider?.getNetwork()).chainId,
      data: data,
    };

    tx.gasLimit = Number(await provider.estimateGas(tx)) + 100000;

    console.log("tx: ", tx);
    notification.remove(id);
    await processTransaction(tx);
  }

  async function unwrapETHWithPKP() {
    const id = notification.info("UWrap ETH with PKP");
    console.log("Current PKP", currentPKP);
    const iface = new Interface(["function withdraw(uint)"]);
    const data = iface.encodeFunctionData("withdraw", [parseEther(amountToSend)]);

    const tx = {
      to: addresses.polygon.wmatic, // spender,
      nonce: await provider.getTransactionCount(currentPKP?.ethAddress as string),
      value: 0,
      gasPrice: await provider.getGasPrice(),
      gasLimit: 0,
      chainId: (await provider?.getNetwork()).chainId,
      data: data,
    };

    tx.gasLimit = Number(await provider.estimateGas(tx)) + 100000;
    notification.remove(id);
    await processTransaction(tx);
  }

  const sendETHWithPKP = async () => {
    const id = notification.info("Sending ETH with PKP");

    const tx = {
      to: targetAddress,
      nonce: await provider.getTransactionCount(currentPKP?.ethAddress as string),
      value: parseEther(amountToSend),
      gasPrice: await provider.getGasPrice(),
      gasLimit: 0,
      chainId: (await provider?.getNetwork()).chainId,
      data: "",
    };

    tx.gasLimit = Number(await provider.estimateGas(tx)) + 100000;

    console.log("tx:", tx);
    notification.remove(id);
    await processTransaction(tx);
  };

  async function transferERC20WithPKP() {
    const id = notification.info("Transfer ERC20 with PKP");

    let decimals = 0;

    for (let i = 0; i < tokenInWallet.length; i++) {
      if (tokenInWallet[i].address === tokenToApprove) {
        const token = new Contract(tokenToApprove, erc20ABI, provider);
        const balance = await token.balanceOf(currentPKP?.ethAddress);
        if (balance) {
          decimals = tokenInWallet[i].decimals;
        }
      }
    }

    const _amountToSend = parseUnits(amountToSend, decimals);

    console.log("Amount to send", Number(_amountToSend));

    const iface = new Interface(["function transfer(address,uint256) returns (bool)"]);
    const data = iface.encodeFunctionData("transfer", [targetAddress, _amountToSend]);

    const tx = {
      to: tokenToApprove,
      nonce: await provider.getTransactionCount(currentPKP?.ethAddress as string),
      value: 0,
      gasPrice: await provider.getGasPrice(),
      gasLimit: 0,
      chainId: (await provider?.getNetwork()).chainId,
      data: data,
    };

    tx.gasLimit = Number(await provider.estimateGas(data)) + 100000;

    console.log("tx:", tx);
    notification.remove(id);
    await processTransaction(tx);
  }

  /**
   * Use wagmi to connect one's eth wallet and then request a signature from one's wallet
   */

  /* async function handleConnectWallet(c: any) {
    const { account, chain, connector } = await connectAsync(c);
    try {
      await authWithWallet(account, connector!);
    } catch (err) {
      console.error(err);
      setError(err);
      setView(Views.ERROR);
    }
  } */

  /**
   * Begin auth flow with Google
   */

  /* async function authWithGoogle() {
    setCurrentProviderType(ProviderType.Google);
    const provider = litAuthClient?.initProvider<GoogleProvider>(ProviderType.Google);
    await provider?.signIn();
  } */

  /**
   * Begin auth flow with Discord
   */

  /* async function authWithDiscord() {
    setCurrentProviderType(ProviderType.Discord);
    const provider = litAuthClient?.initProvider<DiscordProvider>(ProviderType.Discord);
    await provider?.signIn();
  } */

  /**
   * Request a signature from one's wallet
   */
  async function authWithWallet(address: string, connector: Connector) {
    setView(Views.REQUEST_AUTHSIG);

    // Create a function to handle signing messages
    const signer = await connector.getSigner();
    const signAuthSig = async (message: string) => {
      const sig = await signer.signMessage(message);
      return sig;
    };

    // Get auth sig
    const provider = litAuthClient?.getProvider(ProviderType.EthWallet);
    const authMethod = await provider?.authenticate({
      address,
      signMessage: signAuthSig,
      chain: chainName,
    });
    setCurrentProviderType(ProviderType.EthWallet);
    setAuthMethod(authMethod);

    // Fetch PKPs associated with eth wallet account
    setView(Views.FETCHING);
    const pkps: IRelayPKP[] = await provider?.fetchPKPsThroughRelayer(authMethod!);
    if (pkps.length > 0) {
      setPKPs(pkps);
    }
    setView(Views.FETCHED);
  }

  /* async function registerWithWebAuthn() {
    setView(Views.REGISTERING);

    try {
      // Register new PKP
      const provider = litAuthClient?.getProvider(ProviderType.WebAuthn) as WebAuthnProvider;
      setCurrentProviderType(ProviderType.WebAuthn);
      const options = await provider.register();

      // Verify registration and mint PKP through relayer
      const txHash = await provider.verifyAndMintPKPThroughRelayer(options);
      setView(Views.MINTING);
      const response = await provider.relay.pollRequestUntilTerminalState(txHash);
      if (response.status !== "Succeeded") {
        throw new Error("Minting failed");
      }
      const newPKP: IRelayPKP = {
        tokenId: response.pkpTokenId!,
        publicKey: response.pkpPublicKey!,
        ethAddress: response.pkpEthAddress!,
      };

      // Add new PKP to list of PKPs
      const morePKPs: IRelayPKP[] = [...pkps, newPKP];
      setCurrentPKP(newPKP);
      setPKPs(morePKPs);

      setView(Views.REGISTERED);
    } catch (err) {
      console.error(err);
      setError(err);
      setView(Views.ERROR);
    }
  } */

  async function authenticateWithWebAuthn() {
    setView(Views.AUTHENTICATING);

    try {
      const provider = litAuthClient?.getProvider(ProviderType.WebAuthn) as WebAuthnProvider;
      const authMethod = await provider.authenticate();
      setAuthMethod(authMethod);

      // Authenticate with a WebAuthn credential and create session sigs with authentication data
      setView(Views.CREATING_SESSION);

      const sessionSigs = await provider.getSessionSigs({
        pkpPublicKey: currentPKP?.publicKey as string,
        authMethod,
        sessionSigsParams: {
          chain: chainName,
          resources: [`litAction://*`],
        },
      });
      setSessionSigs(sessionSigs);

      setView(Views.SESSION_CREATED);
    } catch (err) {
      console.error(err);
      setAuthMethod(null as any);
      setError(err);
      setView(Views.ERROR);
    }
  }
  /**
   * Handle redirect from Lit login server
   */
  const handleRedirect = useCallback(
    async (providerName: string) => {
      setView(Views.HANDLE_REDIRECT);
      try {
        // Get relevant provider
        let provider: P;
        if (providerName === ProviderType.Google) {
          provider = litAuthClient?.getProvider(ProviderType.Google);
        } else if (providerName === ProviderType.Discord) {
          provider = litAuthClient?.getProvider(ProviderType.Discord);
        }
        setCurrentProviderType(providerName as ProviderType);

        // Get auth method object that has the OAuth token from redirect callback
        const authMethod: AuthMethod = await provider?.authenticate();
        setAuthMethod(authMethod);

        // Fetch PKPs associated with social account
        setView(Views.FETCHING);
        const pkps: IRelayPKP[] = await provider?.fetchPKPsThroughRelayer(authMethod);

        if (pkps.length > 0) {
          setPKPs(pkps);
        }
        setView(Views.FETCHED);
      } catch (err) {
        console.error(err);
        setError(err);
        setView(Views.ERROR);
      }

      // Clear url params once we have the OAuth token
      // Be sure to use the redirect uri route
      router.replace(window.location.pathname, undefined, { shallow: true });
    },
    [litAuthClient, router],
  );

  /**
   * Mint a new PKP for current auth method
   */
  async function mint() {
    setView(Views.MINTING);

    try {
      // Mint new PKP
      const provider = litAuthClient?.getProvider(currentProviderType!);
      const txHash: string = await provider?.mintPKPThroughRelayer(authMethod!);
      const response = await provider?.relay.pollRequestUntilTerminalState(txHash);
      if (response?.status !== "Succeeded") {
        throw new Error("Minting failed");
      }
      const newPKP: IRelayPKP = {
        tokenId: response.pkpTokenId!,
        publicKey: response.pkpPublicKey!,
        ethAddress: response.pkpEthAddress!,
      };

      // Add new PKP to list of PKPs
      const morePKPs: IRelayPKP[] = [...pkps, newPKP];
      setPKPs(morePKPs);

      setView(Views.MINTED);
      setView(Views.CREATING_SESSION);

      // Get session sigs for new PKP
      await createSession(newPKP);
    } catch (err) {
      console.error(err);
      setError(err);
      setView(Views.ERROR);
    }
  }

  /**
   * Generate session sigs for current PKP and auth method
   */
  async function createSession(pkp: IRelayPKP) {
    setWallitDescription("");
    setView(Views.CREATING_SESSION);
    try {
      // Get session signatures
      const provider = litAuthClient?.getProvider(currentProviderType!);
      const sessionSigs = await provider?.getSessionSigs({
        pkpPublicKey: pkp.publicKey,
        authMethod,
        sessionSigsParams: {
          chain: chainName,
          resources: [`litAction://*`, `litEncryptionCondition://*`],
        },
      });
      setCurrentPKP(pkp);
      setSessionSigs(sessionSigs);

      setView(Views.SESSION_CREATED);
    } catch (err) {
      console.error(err);
      setError(err);
      setView(Views.ERROR);
    }
  }

  /**
   * Sign a message with current PKP
   */
  async function signMessageWithPKP() {
    try {
      const toSign = ethers.utils.arrayify(ethers.utils.hashMessage(message));
      const litActionCode = `
        const go = async () => {
          // this requests a signature share from the Lit Node
          // the signature share will be automatically returned in the response from the node
          // and combined into a full signature by the LitJsSdk for you to use on the client
          // all the params (toSign, publicKey, sigName) are passed in from the LitJsSdk.executeJs() function
          const sigShare = await LitActions.signEcdsa({ toSign, publicKey, sigName });
        };
        go();
      `;
      // Sign message
      // @ts-ignore - complains about no authSig, but we don't need one for this action
      const results = await litNodeClient.executeJs({
        code: litActionCode,
        sessionSigs: sessionSigs,
        jsParams: {
          toSign: toSign,
          publicKey: currentPKP?.publicKey,
          sigName: "sig1",
        },
      });
      // Get signature
      const result = results.signatures["sig1"];
      const signature = ethers.utils.joinSignature({
        r: "0x" + result.r,
        s: "0x" + result.s,
        v: result.recid,
      });
      setSignature(signature);

      // Get the address associated with the signature created by signing the message
      const recoveredAddr = ethers.utils.verifyMessage(message, signature);
      setRecoveredAddress(recoveredAddr);
      console.log("recoveredAddr", recoveredAddr);
      // Check if the address associated with the signature is the same as the current PKP
      const verified = currentPKP?.ethAddress.toLowerCase() === recoveredAddr.toLowerCase();
      console.log("verified", verified);
      setVerified(verified);

      const authSig: AuthSig = {
        sig: signature,
        derivedVia: "web3.eth.personal.sign",
        signedMessage: message,
        address: recoveredAddr,
      };

      setAuthSig(authSig);
      console.log("authSig", authSig);

      setView(Views.SESSION_CREATED);

      return authSig;
    } catch (err) {
      console.error(err);
      setError(err);
      setView(Views.ERROR);
    }
  }

  useEffect(() => {
    /**
     * Initialize LitNodeClient and LitAuthClient
     */
    async function initClients() {
      try {
        // Set up LitNodeClient and connect to Lit nodes
        const litNodeClient = new LitNodeClient({
          litNetwork: "serrano",
          debug: false,
        });
        await litNodeClient.connect();
        setLitNodeClient(litNodeClient);

        // Set up LitAuthClient
        const litAuthClient = new LitAuthClient({
          litRelayConfig: {
            relayApiKey: "test-api-key",
          },
          litNodeClient,
        });

        // Initialize providers
        litAuthClient.initProvider<GoogleProvider>(ProviderType.Google);
        litAuthClient.initProvider<DiscordProvider>(ProviderType.Discord);
        litAuthClient.initProvider<EthWalletProvider>(ProviderType.EthWallet);
        litAuthClient.initProvider<WebAuthnProvider>(ProviderType.WebAuthn);

        setLitAuthClient(litAuthClient);
      } catch (err) {
        console.error(err);
        setError(err);
        setView(Views.ERROR);
      }
    }

    if (!litNodeClient) {
      initClients();
    }
  }, [litNodeClient]);

  useEffect(() => {
    // Check if app has been redirected from Lit login server
    if (litAuthClient && !authMethod && isSignInRedirect(redirectUri)) {
      const providerName = getProviderFromUrl();
      handleRedirect(providerName!);
    }
  }, [litAuthClient, handleRedirect, authMethod]);

  if (!litNodeClient) {
    return null;
  }

  return (
    <>
      <Head>
        <title>▣ W A L L I T</title>
        <meta name="description" content="Lines Open Board" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#5bbad5" />
        <meta name="msapplication-TileColor" content="#da532c" />
        <meta name="theme-color" content="#ffffff" />
      </Head>
      <div className="flex items-center flex-col pt-10 text-center">
        {view === Views.ERROR && (
          <>
            <h1 className="text-4xl">🤖</h1>
            <p className="text-xl">{error.message}</p>
            <button
              className="btn btn-primary my-5"
              onClick={() => {
                if (sessionSigs) {
                  setView(Views.SESSION_CREATED);
                } else {
                  if (authMethod) {
                    setView(Views.FETCHED);
                  } else {
                    setView(Views.SIGN_IN);
                  }
                }
                setError(null);
              }}
            >
              Got it
            </button>
          </>
        )}

        {view === Views.SIGN_IN && (
          <>
            {/* <h1 className="text-8xl font-bold">WALLIT</h1> */}
            {/* Since eth wallet is connected, prompt user to sign a message or disconnect their wallet */}
            <>
              {isConnected ? (
                <>
                  <button
                    className="btn btn-primary my-5"
                    disabled={!connector?.ready}
                    key={connector?.id}
                    onClick={async () => {
                      setError(null);
                      await authWithWallet(String(address), connector!);
                      //await handleConnectWallet({ connector });
                    }}
                  >
                    Sign with {connector?.name}
                  </button>
                  <button
                    className="btn btn-primary "
                    onClick={async () => {
                      setError(null);
                      await disconnectAsync();
                    }}
                  >
                    Disconnect wallet
                  </button>
                </>
              ) : (
                <>
                  {/* If eth wallet is not connected, show all login options */}
                  <h1 className="animate-pulse text-lg">Connect Your Wallet First ⚠️</h1>
                  {/* <button className="btn btn-sm" onClick={authWithGoogle}>
                    Google
                  </button>
                  <button className="btn btn-sm" onClick={authWithDiscord}>
                    Discord
                  </button>
                  {connectors.map(connector => (
                    <button
                      className="btn btn-sm"
                      disabled={!connector.ready}
                      key={connector.id}
                      onClick={async () => {
                        setError(null);
                        await handleConnectWallet({ connector });
                      }}
                    >
                      {connector.name}
                    </button>
                  ))}
                  <button onClick={registerWithWebAuthn}>Register with WebAuthn</button> */}
                </>
              )}
            </>
          </>
        )}
        {view === Views.HANDLE_REDIRECT && (
          <>
            <h1>Verifying your identity...</h1>
          </>
        )}
        {view === Views.REQUEST_AUTHSIG && (
          <>
            <h1 className="text-2xl font-bold animate-ping">Check your wallet</h1>
          </>
        )}
        {view === Views.REGISTERING && (
          <>
            <h1>Register your passkey</h1>
            <p>Follow your browser&apos;s prompts to create a passkey.</p>
          </>
        )}
        {view === Views.REGISTERED && (
          <>
            <h1>Minted!</h1>
            <p>Authenticate with your newly registered passkey. Continue when you&apos;re ready.</p>
            <button onClick={authenticateWithWebAuthn}>Continue</button>
          </>
        )}
        {view === Views.AUTHENTICATING && (
          <>
            <h1>Authenticate with your passkey</h1>
            <p>Follow your browser&apos;s prompts to create a passkey.</p>
          </>
        )}
        {view === Views.FETCHING && (
          <>
            <h1 className="text-2xl font-bold animate-ping">Fetching your PKPs...</h1>
          </>
        )}
        {view === Views.FETCHED && (
          <>
            {pkps.length > 0 ? (
              <>
                <h1 className="text-xl">Select a PKP to continue</h1>
                {/* Select a PKP to create session sigs for */}
                <div>
                  {pkps.map(pkp => (
                    <button key={pkp.ethAddress} onClick={async () => await createSession(pkp)}>
                      {pkp.ethAddress}
                    </button>
                  ))}
                </div>
                <hr></hr>
                {/* Or mint another PKP */}
                <p>or mint another one:</p>
                <button className="btn btn-primary" onClick={mint}>
                  Mint another PKP
                </button>
              </>
            ) : (
              <>
                <h1>Mint a PKP to continue</h1>
                <button className="btn btn-primary" onClick={mint}>
                  Mint a PKP
                </button>
              </>
            )}
          </>
        )}
        {view === Views.MINTING && (
          <>
            <h1 className="text-2xl font-bold animate-ping">Minting your PKP...</h1>
          </>
        )}
        {view === Views.MINTED && (
          <>
            <h1 className="text-2xl font-bold animate-bounce">Minted!</h1>
          </>
        )}
        {view === Views.CREATING_SESSION && (
          <>
            <h1 className="text-2xl font-bold animate-zoom">Saving your session...</h1>
          </>
        )}
        {view === Views.SESSION_CREATED && (
          <>
            <div className="text-center items-center">
              <div className="m-5">
                <MetaMaskAvatar address={String(currentPKP?.ethAddress)} size={200} className="hover:animate-spin" />
                <div className="text-6xl text-center font-extrabold Capitalize mb-2 hover:animate-zoom">
                  {wallitDescription!}
                </div>
              </div>
            </div>
            <Address address={currentPKP?.ethAddress} format="long" />
            <div className="items-center">
              <p className="text-6xl font-semibold break-all mb-5 hover:animate-pulse-fast mx-5">
                💲{Number(balance).toFixed(4)}
                <div className="btn btn-circle   text-2xl mx-10 " onClick={async () => fetchTokenInWallet()}>
                  <ArrowPathIcon className="hover:animate-spin" />
                </div>
              </p>
            </div>

            <div className="flex flex-row mx-10">
              <label htmlFor="send-modal" className="btn btn-circle m-5">
                <ArrowRightCircleIcon className="hover:animate-zoom" />
              </label>
              <input type="checkbox" id="send-modal" className="modal-toggle" />
              <div className="modal">
                <div className="modal-box">
                  <h3 className="font-bold text-lg m-2">Send ETH</h3>
                  <input
                    onChange={e => setAmountToSend(e.target.value)}
                    className="input input-bordered w-full mb-4"
                    type="text"
                    required
                    placeholder="Enter amount to send"
                  />
                  <input
                    onChange={e => setTargetAddress(e.target.value)}
                    className="input input-bordered w-full mb-4"
                    type="text"
                    required
                    placeholder="Receiver "
                  />

                  <button onClick={sendETHWithPKP} className="btn btn-primary">
                    Send ETH
                  </button>
                  <div className="divider mb-5 mt-5" />
                  <h3 className="font-bold text-lg m-2">Wrap/Unwrap</h3>

                  <input
                    onChange={e => setAmountToSend(e.target.value)}
                    className="input input-bordered w-full mb-4"
                    type="text"
                    required
                    placeholder="Enter amount to send"
                  />

                  <button onClick={wrapETHWithPKP} className="btn btn-primary mx-2">
                    Wrap ETH
                  </button>
                  <button onClick={unwrapETHWithPKP} className="btn btn-primary">
                    Unwrap ETH
                  </button>
                  <div className="divider mb-5 mt-5" />
                  <h3 className="font-bold text-lg m-2">Send ERC20</h3>
                  <input
                    onChange={e => setAmountToSend(e.target.value)}
                    className="input input-bordered w-full mb-4"
                    type="text"
                    required
                    placeholder="Enter amount to send"
                  />
                  <input
                    onChange={e => setTargetAddress(e.target.value)}
                    className="input input-bordered w-full mb-4"
                    type="text"
                    required
                    placeholder="Receiver "
                  />
                  <select
                    onChange={e => setTokenToApprove(e.target.value)}
                    className="select select-bordered w-full mb-4"
                  >
                    {tokenInWallet.map(token => (
                      <option key={token.address} value={token.address}>
                        {token.symbol}
                      </option>
                    ))}
                  </select>

                  <button onClick={approveERC20WithPKP} className="btn btn-primary mx-2">
                    Approve
                  </button>
                  <button onClick={transferERC20WithPKP} className="btn btn-primary">
                    Transfer
                  </button>
                  <div className="modal-action">
                    <label htmlFor="send-modal" className="btn">
                      Close
                    </label>
                  </div>
                </div>
              </div>

              <label htmlFor="receive-modal" className="btn btn-circle m-5">
                <ArrowDownCircleIcon className="hover:animate-zoom" />
              </label>
              <input type="checkbox" id="receive-modal" className="modal-toggle" />
              <div className="modal">
                <div className="modal-box">
                  <div className="mx-auto text-center items-center w-fit">
                    <QRCodeCanvas
                      id="qrCode"
                      value={String(qrCodeUrl)}
                      size={300}
                      style={{ alignItems: "center" }}
                      /* bgColor={"#00ff00"} */ level={"H"}
                    />
                  </div>
                  <div className="modal-action">
                    <label htmlFor="receive-modal" className="btn">
                      Close
                    </label>
                  </div>
                </div>
              </div>
              <label htmlFor="customtx-modal" className="btn btn-circle m-5">
                <ArrowUpCircleIcon className="hover:animate-zoom" />
              </label>
              <input type="checkbox" id="customtx-modal" className="modal-toggle" />
              <div className="modal">
                <div className="modal-box">
                  <h3 className="font-bold text-lg m-2">Custom Tx</h3>

                  <input
                    onChange={e => setTargetAddress(e.target.value)}
                    className="input input-bordered w-full mb-4"
                    type="text"
                    placeholder="Target Address"
                  />
                  <input
                    value={amountToSend}
                    onChange={e => setAmountToSend(e.target.value)}
                    className="input input-bordered w-full mb-4"
                    type="text"
                    placeholder="Amount to send"
                  />
                  <a href="https://abi.hashex.org/" target="_blank" className="underline" rel="noreferrer">
                    Calculate TxData from ABI
                  </a>

                  <input
                    onChange={e => setCustomTx(e.target.value)}
                    className="input input-bordered w-full my-5"
                    type="text"
                    placeholder="Enter custom tx"
                  />
                  <button onClick={sendCustomTxWithPKP} className="btn btn-primary">
                    Send
                  </button>

                  <div className="modal-action">
                    <label htmlFor="customtx-modal" className="btn">
                      Close
                    </label>
                  </div>
                </div>
              </div>
              <label htmlFor="swap-modal" className="btn btn-circle m-5">
                <ArrowsRightLeftIcon className="hover:animate-spin" />
              </label>
              <input type="checkbox" id="swap-modal" className="modal-toggle" />
              <div className="modal">
                <div className="modal-box">
                  <h3 className="font-bold text-lg">Swap ERC20</h3>
                  ⚠️ Check if the pool exists on Uniswap before swapping
                  <p>
                    Powered by
                    <Image src={UniswapIcon} width={80} height={80} alt="Uniswap" className="hover:animate-zoom" />
                  </p>
                  <select
                    onChange={e => {
                      setTokenFrom(e.target.value);
                      setTokenToApprove(e.target.value);
                    }}
                    className="select select-bordered w-full mb-4 my-5"
                    placeholder="Select Token"
                  >
                    {tokenInWallet.map((token, index) => {
                      return (
                        <option key={index} value={token.address}>
                          <div>{token.name}</div>
                        </option>
                      );
                    })}
                  </select>
                  <select
                    onChange={e => setTokenTo(e.target.value)}
                    className="select select-bordered w-full mb-4"
                    placeholder="Select Token"
                  >
                    {tokenList.map((token, index) => {
                      return (
                        <option key={index} value={token.address}>
                          <div>{token.name}</div>
                        </option>
                      );
                    })}
                  </select>
                  <input
                    onChange={e => setAmountToSwap(e.target.value)}
                    className="input input-bordered w-full mb-4"
                    type="text"
                    placeholder="Amount To Swap"
                  />
                  <button onClick={swapUniswapExactInputSingle} className="btn btn-primary">
                    Swap
                  </button>
                  <div className="modal-action">
                    <label htmlFor="swap-modal" className="btn">
                      Close
                    </label>
                  </div>
                </div>
              </div>
              <a href={zapperUrl!} target="_blank" className="btn btn-circle m-5" rel="noreferrer">
                <ArchiveBoxIcon className="hover:animate-zoom" />
              </a>
            </div>
            <div className="flex items-center justify-between mb-10 mt-10">
              <p className="text-left  mx-2"> ↩️ Switch </p>
              <select
                className="select select-bordered"
                onChange={async e => {
                  createSession(pkps.find(p => p.ethAddress === e.target.value));
                }}
                z
              >
                {pkps.map(pkp => (
                  <option key={pkp.ethAddress} value={pkp.ethAddress}>
                    {pkp.ethAddress}
                  </option>
                ))}
              </select>
            </div>
            {tokenInWallet && (
              <div className="grid md:grid-cols-2 sm:grid-cols lg:grid-cols-2 gap-4 my-10">
                {tokenInWallet.map((token, index) => {
                  return (
                    <div className="bg-base-300 shadow-lg rounded-lg p-6" key={index}>
                      <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold">{token.name}</h2>
                        <img src={token.logoURI} className="w-10 h-10" alt={`${token.name} logo`} />
                      </div>
                      <p className="text-sm text-primary">{token.symbol}</p>
                      <p className="text-lg font-bold">
                        {token.decimals == 18
                          ? String(token.balance / 1e18)
                          : token.decimals == 6
                          ? String(token.balance / 1e6)
                          : token.decimals == 8
                          ? String(token.balance / 1e8)
                          : String(token.balance / 1e12)}
                      </p>
                      <p className="text-xs text-gray-500">{token.address}</p>
                    </div>
                  );
                })}
              </div>
            )}
            {yourWallit === "0x0000000000000000000000000000000000000000" && yourWallit ? (
              <div>
                <button
                  className="btn btn-primary my-5"
                  onClick={async () => {
                    createWallit();
                  }}
                >
                  Name your account
                </button>
              </div>
            ) : null}
            <div className="w-fit mt-10 text-left">
              <div className="mx-4">
                <h1 className="text-lg">Give a name to yuour Wallit 🤖</h1>
                <div className="card card-compact mb-10">
                  <input
                    className="input input-primary w-full  mt-5"
                    type="text"
                    placeholder="Name your WALLIT"
                    onChange={e => {
                      setWallitName(e.target.value);
                    }}
                  />
                  <button
                    className="btn btn-primary  mt-5"
                    onClick={() => {
                      txData(executeSetWallitName?.writeAsync?.());
                    }}
                  >
                    set name
                  </button>
                </div>
              </div>
            </div>
            <div className="collapse">
              <input type="checkbox" />
              <div className="collapse-title text-2xl font-extrabold">👇🏻DO NOT TRUST VERIFY!</div>
              <div className="collapse-content bg-secondary rounded-lg">
                <p className="text-lg">Write a message and Sign it with your PKP</p>
                <input
                  onChange={e => setMessage(e.target.value)}
                  className="input input-bordered w-96 m-1 py-2"
                  type="text"
                  required
                  placeholder="Enter message to sign"
                />
                <br></br>
                <button className="btn btn-primary my-5" onClick={signMessageWithPKP}>
                  Sign message
                </button>
                {signature && (
                  <>
                    <h3 className="text-lg">Your signature:</h3>
                    <p className="break-all font-bold">{signature}</p>
                    <h2 className="text-lg">Recovered address</h2>
                    <p className="font-bold">{recoveredAddress}</p>
                    <h3>Verified</h3>
                    <p className="font-bold">{verified ? "true" : "false"}</p>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default Home;
