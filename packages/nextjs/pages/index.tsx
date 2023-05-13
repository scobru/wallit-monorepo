import { useCallback, useEffect, useReducer, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import { useRouter } from "next/router";
import { useScaffoldContractRead, useTransactor } from "../hooks/scaffold-eth";
import { useScaffoldContractWrite } from "../hooks/scaffold-eth";
import UniswapIcon from "../uniswap.png";
import { addresses } from "../utils/constant";
import { getWalletAuthSig } from "../utils/get-wallet-auth-sig";
import { getStrategyExecutionPlanAction } from "./actions/get-strategy-execution-plan";
import { getTokenPriceAction } from "./actions/get-token-price";
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
import { multicall } from "@wagmi/core";
import { P } from "@wagmi/core/dist/index-35b6525c";
import { Contract, ethers } from "ethers";
import {
  Interface,
  arrayify,
  computeAddress,
  computePublicKey,
  joinSignature,
  keccak256,
  parseEther,
  parseUnits,
  recoverAddress,
  recoverPublicKey,
  serializeTransaction,
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

const StateReducer = "../utils/StateReducer";

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
  const redirectUri = "https://localhost:3000";
  const { data: signer } = useSigner();
  const account = useAccount();
  const signerAddress = account?.address;
  const provider = useProvider();
  const router = useRouter();
  const chainName = "polygon";
  const txData = useTransactor();
  const block = useBlockNumber();

  const getStrategyExecutionPlanRaw = "../actions/get-strategy-execution-plan-raw";
  const getTokenPriceRaw = "../actions/get-token-price-raw";

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
  const zapperUrl = "https://zapper.xyz/account/" + currentPKP?.ethAddress || undefined;
  const qrCodeUrl = "ethereum:" + currentPKP?.ethAddress + "/pay?chain_id=137value=0";

  const [state, dispatch] = useReducer(StateReducer, {
    data: {
      jsCode: getTokenPriceRaw,
      //jsonCode: JSON.parse(ssProp.demoParams),
    },
    loading: false,
  });

  const LitActions = {
    call: async executeJsProps => {
      const client = new LitNodeClient({
        litNetwork: "serrano",
        debug: false,
      });
      await client.connect();

      const sig = await client.executeJs(executeJsProps);

      return sig;
    },
  };

  const executeSetWallitNamePrepared = usePrepareContractWrite({
    address: String(yourWallit),
    abi: wallitCtx?.abi,
    functionName: "setName",
    args: [wallitName, String(currentPKP?.ethAddress)],
  });
  const executeSetWallitName = useContractWrite(executeSetWallitNamePrepared.config);

  const fakeData = {
    pkpPublicKey: currentPKP?.publicKey,
    strategy: [
      { token: "UNI", percentage: 50 },
      { token: "WMATIC", percentage: 50 },
    ],
    conditions: {
      maxGasPrice: 75,
      unit: "gwei",
      minExceedPercentage: 1,
      unless: {
        spikePercentage: 15,
        adjustGasPrice: 500,
      },
    },
    rpcUrl: process.env.MATIC_RPC,
    dryRun: false,
  };

  // if metamask is disconnected change view with setView
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
      gasLimit: 5000000,
      chainId: (await provider.getNetwork()).chainId,
      data: await generateSwapExactInputSingleCalldata(exactInputSingleParams),
    };

    /* tx.gasLimit =
      Number(await provider.estimateGas(await generateSwapExactInputSingleCalldata(exactInputSingleParams))) + 500000; */

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
      tokenFrom, // cEUR
      currentPKP?.ethAddress, // owner
      addresses.polygon.uniswap.v3.SwapRouter02, // spender
      provider,
    );

    if (allowance.eq(0)) {
      console.log("[Wallit]: approving maximum allowance for swap...");
      setTokenToApprove(tokenFrom!);
      setAmountToSend(String(amountToSwap));
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

    console.log("[Wallit]: no approval needed, swapping...");

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
      gasLimit: 500000,
      chainId: (await provider?.getNetwork()).chainId,
      data: data,
    };

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
      gasLimit: 5000000,
      chainId: (await provider?.getNetwork()).chainId,
      data: data,
    };

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
      gasLimit: 5000000,
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
      gasLimit: 5000000,
      chainId: (await provider?.getNetwork()).chainId,
      data: data,
    };

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
    setAuthSig(JSON.parse(authMethod?.accessToken as string));

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

      setView(Views.SESSION_CREATED);

      return authSig;
    } catch (err) {
      console.error(err);
      setError(err);
      setView(Views.ERROR);
    }
  }

  /** USE EFFECTS **/

  useEffect(() => {
    fetchTokenList();
    fetchTokenInWallet();
  }, []);

  /* useEffect(() => {
    if (!address) {
      setView(Views.SIGN_IN);
    }
  }, [address]);

  useEffect(() => {
    if (address) {
      setView(Views.SIGN_IN);
    }
  }, [address]); */

  useEffect(() => {
    if (wallitCtx && yourWallit != ethers.constants.AddressZero && signer && currentPKP?.ethAddress) {
      const contract = new ethers.Contract(String(yourWallit), wallitCtx?.abi, signer || provider);
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

  async function getUSDPrice(symbol: any) {
    console.log(`[Get USD Price] Running Lit Action to get ${symbol}/USD price...`);

    const res = await litNodeClient?.executeJs({
      sessionSigs: sessionSigs,
      code: getTokenPriceAction,
      jsParams: {
        tokenSymbol: symbol,
      },
      authSig: undefined as unknown as AuthSig,
    });

    console.log(`[Get USD Price] Lit Action response:`, res);

    return res;
  }

  /**
   *
   * This function is used to get the current balances of the specified ERC20 tokens.
   * It takes in the `tokens` array, `pkpAddress` (public key pair address) and the `provider`
   * as arguments and returns an array of objects containing the token symbol, balance and value.
   *
   * @param { Array<SwapToken> } tokens
   * @param { string } pkpAddress
   * @param { JsonRpcProvider } provider
   * @returns { CurrentBalance }
   */

  async function getPortfolio(tokens: any[], pkpAddress: any, provider: any): CurrentBalance {
    console.log(`[Lit Action] [FAKE] Running Lit Action to get portfolio...`);

    const tokenSymbolMapper = {
      WMATIC: "MATIC",
      UNI: "UNI",
    };

    // Using Promise.all, we retrieve the balance and value of each token in the `tokens` array.
    const balances = await Promise.all(
      tokens.map(async token => {
        const ERC20 = new ethers.Contract(token.address, erc20ABI, provider);

        // Get the token balance using the `ERC20.getBalance` method.
        let balance = await ERC20.balanceOf(pkpAddress);

        // Get the number of decimal places of the token using the `ERC20.getDecimals` method.
        const decimals = token.decimals;

        // Format the token balance to have the correct number of decimal places.
        balance = parseFloat(ethers.utils.formatUnits(balance, decimals));

        // Get the token symbol using the `tokenSymbolMapper` or the original symbol if not found.
        const priceSymbol = tokenSymbolMapper[token.symbol] ?? token.symbol;
        //const priceSymbol = token.symbol;

        // Get the token value in USD using the `getUSDPrice` function.
        const priceResult = await getUSDPrice(priceSymbol);
        const value = (await priceResult?.response.data.USD) * balance;

        console.log(token, balance, value);

        // Return an CurrentBalance object containing the token symbol, balance and value.
        return {
          token,
          balance,
          value,
        };
      }),
    );

    return { status: 200, data: balances };
  }

  /**
   * This function is used to balance a token portfolio based on a given strategy.
   * It takes in the `portfolio` array and the `strategy` array as arguments and returns an object
   * with the `tokenToSell`, `percentageToSell`, `amountToSell`, and `tokenToBuy` properties.
   * @param { Array<CurrentBalance> } portfolio
   * @param { Array<{ token: string, percentage: number }> } strategy
   *
   * @returns { StrategyExecutionPlan }
   */

  async function getStrategyExecutionPlan(portfolio: any, strategy: any): Promise<Response> {
    console.log(`[Lit Action] Running Lit Action to get strategy execution plan...`);
    console.log(`[Strategy Ececution Plan] Running Lit Action to get strategy execution plan...`);

    const privateKey = process.env.NEXT_PUBLIC_SERVER_PRIVATE_KEY;
    const serverAuthSig = await getWalletAuthSig({
      privateKey: privateKey as string,
      chainId: 137,
    });

    const code = getStrategyExecutionPlanAction;

    console.log(`[Strategy Ececution Plan] ServerAuthSig:`, serverAuthSig);

    const res = await LitActions.call({
      targetNodeRange: 1,
      authSig: serverAuthSig,
      code: code,
      jsParams: {
        portfolio,
        strategy,
      },
    });

    return res.response;
  }

  // -------------------------------------------------------------------
  //          Let's pretend this function lives on Lit Action
  // -------------------------------------------------------------------
  const executeSwap = async ({ jsParams }) => {
    // --------------------------------------
    //          Checking JS Params
    // --------------------------------------

    console.log("JS Params: ", jsParams);
    console.log("[Execute Swap] Running Lit Action to execute swap...");

    const { tokenIn, tokenOut, pkp, authSig, amountToSell, provider, conditions } = jsParams;

    // if pkp.public key doesn't start with 0x, add it
    if (!pkp.publicKey.startsWith("0x")) {
      pkp.publicKey = "0x" + pkp.publicKey;
    }

    const pkpAddress = computeAddress(pkp.publicKey);

    // ------------------------------------------------------------------------------
    //          ! NOTE ! Let's pretend these functions works on Lit Action
    // ------------------------------------------------------------------------------

    const Lit = {
      Actions: {
        getGasPrice: () => provider.getGasPrice(),
        getTransactionCount: (walletAddress: any) => provider.getTransactionCount(walletAddress),
        getNetwork: () => provider.getNetwork(),
        sendTransaction: (tx: any) => provider.sendTransaction(tx),
      },
    };

    class Code {
      static signEcdsa = `(async() => {
      const sigShare = await LitActions.signEcdsa({ toSign, publicKey, sigName });
    })();`;
    }

    // ------------------------------------
    //          Helper Functions
    // ------------------------------------
    /**
     * This will check if the tx has been approved by checking if the allowance is greater than 0
     * @param { string } tokenInAddress
     * @param { string } pkpAddress
     * @param { string } swapRouterAddress
     *
     * @returns { BigNumber } allowance
     */
    const getAllowance = async ({ tokenInAddress, pkpAddress, swapRouterAddress }: string): BigNumber => {
      console.log(`[Lit Action] Running Lit Action to get allowance...`);
      console.log(`[Lit Action] tokenInAddress: ${tokenInAddress}`);
      console.log(`[Lit Action] pkpAddress: ${pkpAddress}`);
      console.log(`[Lit Action] swapRouterAddress: ${swapRouterAddress}`);

      try {
        const tokenInContract = new Contract(
          tokenInAddress,
          ["function allowance(address,address) view returns (uint256)"],
          provider,
        );
        const tokenInAllowance = await tokenInContract.allowance(pkpAddress, swapRouterAddress);

        return tokenInAllowance;
      } catch (e) {
        console.log(e);
        throw new Error("Error getting allowance");
      }
    };

    /**
     * Convert a tx to a message
     * @param { any } tx
     * @returns { string }
     */
    const txToMsg = (tx: any): string => arrayify(keccak256(arrayify(serializeTransaction(tx))));

    /**
     * Get basic tx info
     */
    const getBasicTxInfo = async ({ walletAddress }) => {
      try {
        const nonce = await Lit.Actions.getTransactionCount(walletAddress);
        const gasPrice = await Lit.Actions.getGasPrice();
        const { chainId } = await Lit.Actions.getNetwork();
        return { nonce, gasPrice, chainId };
      } catch (e) {
        console.log(e);
        throw new Error("Error getting basic tx info");
      }
    };

    /**
     * Get encoded signature
     */
    const getEncodedSignature = sig => {
      try {
        const _sig = {
          r: "0x" + sig.r,
          s: "0x" + sig.s,
          recoveryParam: sig.recid,
        };

        const encodedSignature = joinSignature(_sig);

        return encodedSignature;
      } catch (e) {
        console.log(e);
        throw new Error("Error getting encoded signature");
      }
    };

    /**
     * Sending tx
     * @param param0
     */
    const sendTx = async ({ originalUnsignedTx, signedTxSignature }) => {
      try {
        const serialized = serializeTransaction(originalUnsignedTx, signedTxSignature);

        return await Lit.Actions.sendTransaction(serialized);
      } catch (e) {
        console.log(e);
        throw new Error("Error sending tx");
      }
    };

    /**
     * This will approve the swap
     */
    const approveSwap = async ({
      swapRouterAddress,
      maxAmountToApprove = ethers.constants.MaxUint256,
      tokenInAddress,
    }) => {
      console.log("Approving swap...");

      // getting approve data from swap router address
      const approveData = new Interface(["function approve(address,uint256) returns (bool)"]).encodeFunctionData(
        "approve",
        [swapRouterAddress, maxAmountToApprove],
      );

      // get the basic tx info such as nonce, gasPrice, chainId
      const { nonce, gasPrice, chainId } = await getBasicTxInfo({
        walletAddress: pkpAddress,
      });

      // create the unsigned tx
      const unsignedTx = {
        to: tokenInAddress,
        nonce,
        value: 0,
        gasPrice,
        gasLimit: 500000,
        chainId,
        data: approveData,
      };

      const message = txToMsg(unsignedTx);

      // sign the tx (with lit action)
      const sigName = "approve-tx-sig";
      const res = await LitActions.call({
        code: Code.signEcdsa,
        sessionSigs: sessionSigs,
        jsParams: {
          toSign: message,
          publicKey: pkp.publicKey,
          sigName,
        },
      });

      // get encoded signature
      const encodedSignature = getEncodedSignature(res.signatures[sigName]);

      const sentTx = await sendTx({
        originalUnsignedTx: unsignedTx,
        signedTxSignature: encodedSignature,
      });

      await sentTx.wait();

      return sentTx;
    };

    /**
     * This will swap the token
     */
    const swap = async ({ swapRouterAddress, swapParams }) => {
      console.log("[Swap] Swapping...");

      // get "swap exact input single" data from contract
      const swapData = new Interface([
        "function exactInputSingle(tuple(address,address,uint24,address,uint256,uint256,uint160)) external payable returns (uint256)",
      ]).encodeFunctionData("exactInputSingle", [
        [
          swapParams.tokenIn,
          swapParams.tokenOut,
          swapParams.fee,
          swapParams.recipient,
          swapParams.amountIn,
          swapParams.amountOutMinimum,
          swapParams.sqrtPriceLimitX96,
        ],
      ]);

      console.log(`[Swap] Getting basic tx info...`);
      // get the basic tx info such as nonce, gasPrice, chainId
      const { nonce, gasPrice, chainId } = await getBasicTxInfo({
        walletAddress: pkpAddress,
      });

      // get gas price in gwei
      const _gasPrice = ethers.utils.formatUnits(gasPrice, conditions.maxGasPrice.unit);

      console.log(`[Swap] Gas Price(${conditions.maxGasPrice.unit}): ${_gasPrice}`);

      if (_gasPrice > conditions.maxGasPrice.value) {
        console.log(`[Swap] Gas price is too high, aborting!`);

        console.log(`[Swap] Max gas price: ${conditions.maxGasPrice.value}`);
        console.log(`[Swap] That's ${_gasPrice - conditions.maxGasPrice.value} too high!`);
        return;
      } else {
        console.log(`[Swap] Gas price is ok, proceeding...`);
      }

      // create the unsigned tx
      const unsignedTx = {
        to: swapRouterAddress,
        nonce,
        value: 0,
        gasPrice,
        gasLimit: 500000,
        chainId,
        data: swapData,
      };

      const message = txToMsg(unsignedTx);

      console.log(`[Swap] Signing with Lit Action...`);
      // sign the tx (with lit action)
      const sigName = "swap-tx-sig";
      const res = await LitActions.call({
        code: Code.signEcdsa,
        sessionSigs: sessionSigs,
        jsParams: {
          toSign: message,
          publicKey: pkp.publicKey,
          sigName,
        },
      });

      // get encoded signature
      const encodedSignature = getEncodedSignature(res.signatures[sigName]);

      console.log(`[Swap] Sending tx...`);
      const sentTx = await sendTx({
        originalUnsignedTx: unsignedTx,
        signedTxSignature: encodedSignature,
      });

      console.log(`[Swap] Waiting for tx to be mined...`);
      await sentTx.wait();

      return sentTx;
    };

    // --------------------------------------------------------------------------
    //          This is where the actual logic being run in Lit Action
    // --------------------------------------------------------------------------

    console.log("[ExecuteSwap] Starting...");

    console.log("[ExecuteSwap] Allowance: ");

    // get the allowance of the contract to spend the token
    const allowance = await getAllowance({
      tokenInAddress: tokenIn.address,
      pkpAddress,
      swapRouterAddress: addresses.polygon.uniswap.v3.SwapRouter02,
    });

    console.log("[ExecuteSwap] 1. allowance:", allowance.toString());

    // if it's NOT approved, then we need to approve the swap
    if (allowance <= 0) {
      console.log("[ExecuteSwap] 2. NOT approved! approving now...");
      await approveSwap({
        swapRouterAddress: addresses.polygon.uniswap.v3.SwapRouter02,
        tokenInAddress: tokenIn.address,
      });
    }

    console.log("[ExecuteSwap] 3. Approved! swapping now...");
    return await swap({
      swapRouterAddress: addresses.polygon.uniswap.v3.SwapRouter02,
      swapParams: {
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        fee: 3000,
        recipient: pkpAddress,
        // deadline: (optional)
        amountIn: ethers.utils.parseUnits(amountToSell, tokenIn.decimals),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      },
    });
  };

  /**
   *
   * @param { Array<SwapToken> } tokens
   * @param { string } pkpAddress
   * @param { { getUSDPriceCallback: (symbol: string) => Promise<PriceData> } } options
   * @param { Array<{ token: string, percentage: number }> } strategy eg. [{ token: "WMATIC", percentage: 50 }, { token: "USDC", percentage: 50 }]
   * @param { RebalanceConditions } conditions
   * @param { string } rpcUrl
   * @param { boolean } dryRun
   * @returns { Promise<TX> }
   *
   *
   */
  async function runBalancePortfolio({
    tokens,
    pkpPublicKey,
    strategy,
    conditions = {
      maxGasPrice: 80,
      unit: "gwei",
      minExceedPercentage: 1,
      unless: { spikePercentage: 10, adjustGasPrice: 500 },
    },
    provider,
    dryRun = false,
  }: Array<SwapToken>): Promise<TX> {
    // get execution time
    const startTime = new Date().getTime();
    // get current date and time in the format: YYYY-MM-DD HH:mm:ss in UK time
    const now = new Date().toLocaleString("en-GB");
    console.log(`[BalancePortfolio] => Start ${now}`);

    const pkpAddress = computeAddress(pkpPublicKey);

    // -- Portfolio --
    let portfolio = [];
    try {
      console.log(`[BalancePortfolio] Getting portfolio...`);
      const res = await getPortfolio(tokens, pkpAddress, provider);
      portfolio = res.data;
    } catch (e) {
      const msg = `Error getting portfolio: ${e.message}`;
      console.log(`[BalancePortfolio] ${msg}`);
      return { status: 500, data: msg };
    }

    // log each token balance and value in the format of
    // { symbol: "WMATIC", balance: 0.000000000000000001, value: 0.000000000000000001}
    portfolio.forEach((currentBalance: { token: { symbol: any }; balance: any; value: any }) => {
      console.log(
        `[BalancePortfolio] currentBalance: { symbol: "${currentBalance.token.symbol}", balance: ${currentBalance.balance}, value: ${currentBalance.value} }`,
      );
    });

    console.log(`[BalancePortfolio] Total value: ${portfolio.reduce((a, b) => a + b.value, 0)}`);

    // -- Strategy Execution Plan --
    let plan;

    console.log(`[BalancePortfolio] Getting strategy execution plan...`);
    console.log("[BalancePortfolio] Strategy:", strategy);
    console.log("[BalancePortfolio] Portfolio: ", portfolio);

    try {
      const res = await getStrategyExecutionPlan(portfolio, strategy);
      console.log("response:", res);
      plan = res?.data;
      console.log(plan);
    } catch (e) {
      console.log(`[BalancePortfolio] Error getting strategy execution plan: ${e.message}`);
      return { status: 500, data: "Error getting strategy execution plan" };
    }
    console.log(`[BalancePortfolio] PKP Address: ${pkpAddress}`);
    console.log(
      `[BalancePortfolio] Proposed to swap ${plan.tokenToSell.symbol} for ${plan.tokenToBuy.symbol}. Percentage difference is ${plan.valueDiff.percentage}%.`,
    );

    // -- Guard Conditions --
    let atLeastPercentageDiff = conditions.minExceedPercentage; // eg. 1 = 1%

    // If the percentage difference is less than 5%, then don't execute the swap
    if (plan.valueDiff.percentage < atLeastPercentageDiff) {
      const msg = `No need to execute swap, percentage is only ${plan.valueDiff.percentage}% which is less than ${atLeastPercentageDiff}% required.`;
      console.log(`[BalancePortfolio] ${msg}`);
      return { status: 412, data: msg };
    }

    // this usually happens when the price of the token has spiked in the last moments
    const spikePercentageDiff = conditions.unless.spikePercentage; // eg. 15 => 15%

    // Unless the percentage difference is greater than 15%, then set the max gas price to 1000 gwei
    // otherwise, set the max gas price to 100 gwei
    const _maxGasPrice =
      plan.valueDiff.percentage > spikePercentageDiff
        ? {
            value: conditions.unless.adjustGasPrice,
            unit: conditions.unit,
          }
        : {
            value: conditions.maxGasPrice,
            unit: conditions.unit,
          };
    console.log("[BalancePortfolio] maxGasPrice:", _maxGasPrice);

    if (dryRun) {
      return { status: 200, data: "dry run, skipping swap..." };
    }

    // -- Execute Swap --
    let tx;
    try {
      tx = await executeSwap({
        jsParams: {
          sessionSigs: sessionSigs,
          provider: provider,
          tokenIn: plan.tokenToSell,
          tokenOut: plan.tokenToBuy,
          pkp: {
            publicKey: pkpPublicKey,
          },
          amountToSell: plan.amountToSell.toString(),
          conditions: {
            maxGasPrice: _maxGasPrice,
          },
        },
      });
    } catch (e) {
      const msg = `Error executing swap: ${e.message}`;
      console.log(`[BalancePortfolio] ${msg}`);
      return { status: 500, data: msg };
    }

    // get execution time
    const endTime = new Date().getTime();
    const executionTime = (endTime - startTime) / 1000;

    console.log(`[BalancePortfolio] => End ${executionTime} seconds`);

    return {
      status: 200,
      data: {
        tx,
        executionTime,
      },
    };
  }

  // async function getStrategyExecutionPlanMock(tokens, strategy) {
  //   // if the strategy percentage is not 100, throw an error
  //   if (strategy.reduce((sum, s) => sum + s.percentage, 0) !== 100) {
  //     // show which token can be adjusted with another percentage to make the total 100
  //     let tokenToAdjust = strategy.find(s => s.percentage !== 0);
  //     let adjustedPercentage = 100 - strategy.reduce((sum, s) => sum + s.percentage, 0);

  //     let total = tokenToAdjust.percentage + adjustedPercentage;

  //     throw new Error(
  //       `Strategy percentages must add up to 100 - The total strategy percentage for all assets must equal 100, with a suggested allocation of ${total}% for ${tokenToAdjust.token} to reach this total.`,
  //     );
  //   }

  //   // this will both set the response to the client and return the data internally
  //   const respond = data => {
  //     Lit.Actions.setResponse({
  //       response: JSON.stringify(data),
  //     });

  //     return data;
  //   };
  //   // Calculate the total value of the portfolio
  //   let totalValue = tokens.reduce((sum, token) => sum + token.value, 0);
  //   console.log("totalValue:", totalValue);
  //   // Calculate the target percentage for each token based on the strategy
  //   let targetPercentages = strategy.map(s => s.percentage / 100);
  //   console.log("targetPercentages:", targetPercentages);

  //   // Calculate the target value for each token
  //   let targetValues = targetPercentages.map(p => totalValue * p);
  //   console.log("targetValues:", targetValues);

  //   // Create a mapping between the token symbol and its index in the tokens array
  //   let tokenIndexMap = tokens.reduce((map, token, index) => {
  //     map[token.token.symbol] = index;
  //     return map;
  //   }, {});
  //   console.log("tokenIndexMap:", tokenIndexMap);

  //   // Calculate the difference between the target value and the current value for each token
  //   let diffValues = strategy.map((s, index) => {
  //     let tokenIndex = tokenIndexMap[s.token];
  //     return targetValues[index] - tokens[tokenIndex].value;
  //   });
  //   console.log("diffValues:", diffValues);

  //   // Determine which token to buy by finding the token with the largest negative difference
  //   let tokenToBuyIndex = diffValues.reduce(
  //     (maxIndex, diff, index) => (diff > diffValues[maxIndex] ? index : maxIndex),
  //     0,
  //   );
  //   console.log("tokenToBuyIndex:", tokenToBuyIndex);

  //   // Calculate the amount of the token to sell
  //   let percentageToSell = diffValues[tokenToBuyIndex] / tokens[tokenToBuyIndex].value;
  //   console.log("percentageToSell:", percentageToSell);

  //   // get the actual amount of token to sell
  //   let amountToSell = tokens[tokenToBuyIndex].balance * percentageToSell;
  //   console.log("amountToSell:", amountToSell);

  //   // Determine which token to sell by finding the token with the largest positive difference
  //   let tokenToSellIndex = diffValues.reduce(
  //     (minIndex, diff, index) => (diff < diffValues[minIndex] ? index : minIndex),
  //     0,
  //   );
  //   console.log("tokenToSellIndex:", tokenToSellIndex);

  //   const toSellSymbol = strategy[tokenToSellIndex].token;
  //   const toBuySymbol = strategy[tokenToBuyIndex].token;

  //   // find to sell token param tokens
  //   const toSellToken = tokens.find(token => token.token.symbol === toSellSymbol).token;

  //   //  find to buy token
  //   const toBuyToken = tokens.find(token => token.token.symbol === toBuySymbol).token;

  //   // calculate the percentage difference between the strategy and the current portfolio, and show which token is it
  //   const proposedAllocation = diffValues.map((diff, index) => {
  //     const percentageDiff = (diff / totalValue) * 100;
  //     const token = strategy[index].token;
  //     return { token, percentageDiff };
  //   });

  //   // sell allocation
  //   const sellPercentageDiff = proposedAllocation.find(token => {
  //     return token.token === toSellToken.symbol;
  //   });

  //   // Return the token to sell and the amount to sell
  //   return respond({
  //     status: 200,
  //     data: {
  //       tokenToSell: toSellToken,
  //       percentageToSell: Math.abs(percentageToSell),
  //       amountToSell: amountToSell.toFixed(6).toString(),
  //       tokenToBuy: toBuyToken,
  //       proposedAllocation,
  //       valueDiff: {
  //         token: sellPercentageDiff.token,
  //         percentage: Math.abs(sellPercentageDiff.percentageDiff).toFixed(2),
  //       },
  //     },
  //   });
  // }

  // (async () => {
  //   // --------------------------------------
  //   //          JS Params Handling
  //   // --------------------------------------
  //   const jsParams = {};

  //   try {
  //     jsParams.portfolio = portfolio;
  //   } catch (e) {
  //     console.error("[ERROR] portfolio is required");
  //     return;
  //   }

  //   try {
  //     jsParams.strategy = strategy;
  //   } catch (e) {
  //     console.error("[ERROR] strategy is required");
  //     return;
  //   }

  //   // -----------------------
  //   //          GO!
  //   // -----------------------
  //   const res = await getStrategyExecutionPlan(portfolio, strategy);

  //   console.log("res:", res);
  // })();

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
            <div className="flex items-center flex-col flex-grow pt-5">
              <div className="text-center items-center mx-auto">
                <div className="my-2">
                  <MetaMaskAvatar address={String(currentPKP?.ethAddress)} size={200} className="hover:animate-spin" />
                  <div className="text-6xl text-center font-extrabold Capitalize mb-2 hover:animate-zoom">
                    {wallitDescription!}
                  </div>
                </div>
              </div>
              <div>
                <div className="w-fit mx-auto">
                  <Address address={currentPKP?.ethAddress} format="short" />
                </div>
                <div className="items-center flex flex-row">
                  <p className="text-6xl font-light   hover:animate-pulse-fast  items-center text-center  mx-auto my-10">
                    💲{Number(balance).toFixed(3)}
                  </p>
                  <div
                    className="btn btn-circle   text-2xl mx-10 "
                    onClick={async () => {
                      fetchTokenInWallet();
                    }}
                  >
                    <ArrowPathIcon className="hover:animate-spin" height={30} width={30} />
                  </div>
                  <div
                    className="btn btn-circle   text-2xl mx-10 "
                    onClick={async () => {
                      const tokenInWalletFilter = tokenInWallet?.filter(
                        token =>
                          token.symbol === fakeData.strategy[0].token || token.symbol === fakeData.strategy[1].token,
                      );

                      //const portfolio = await getPortfolio(tokenInWalletFilter, currentPKP?.ethAddress, provider);
                      //await getStrategyExecutionPlanMock(portfolio.data, fakeData.strategy);
                      let counter = 0;
                      while (true) {
                        counter++;

                        console.log(`counter:`, counter);
                        await runBalancePortfolio({
                          tokens: tokenInWalletFilter,
                          pkpPublicKey: currentPKP?.publicKey,
                          strategy: fakeData.strategy,
                          provider,
                        });

                        console.log("[Task] res:", res);
                        console.log("[Task] waiting for 5 minutes before continuing...");
                        await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
                      }
                    }}
                  >
                    <ArrowPathIcon className="hover:animate-spin" height={50} width={50} />
                  </div>
                </div>
              </div>
              <div className="flex-row mx-1">
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
              <div className="flex items-center mb-10 mt-5">
                <span className="mx-5 font-medium">Switch to</span>
                <select
                  className="select"
                  onChange={async e => {
                    createSession(pkps.find(p => p.ethAddress === e.target.value));
                  }}
                >
                  {pkps.map(pkp => (
                    <option key={pkp.ethAddress} value={pkp.ethAddress}>
                      <Address address={pkp.ethAddress} format="short" />
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-md" onClick={mint}>
                Mint another PKP
              </button>
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
              {yourWallit === ethers.constants.AddressZero && yourWallit ? (
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
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default Home;
function safeFetch(arg0: string, arg1: any, arg2: (e: Error) => void) {
  throw new Error("Function not implemented.");
}
