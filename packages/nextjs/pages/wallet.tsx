import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { ProviderType } from "@lit-protocol/constants";
import {
  BaseProvider,
  DiscordProvider,
  EthWalletProvider,
  GoogleProvider,
  LitAuthClient,
  WebAuthnProvider,
  getProviderFromUrl,
  isSignInRedirect,
} from "@lit-protocol/lit-auth-client";
import {
  LitNodeClient,
  checkAndSignAuthMessage,
  decryptString,
  encryptString,
  hashResourceIdForSigning,
  uint8arrayToString,
} from "@lit-protocol/lit-node-client";
import { AuthMethod, AuthSig, IRelayPKP, SessionSigs } from "@lit-protocol/types";
import { P } from "@wagmi/core/dist/index-35b6525c";
import { ContractInterface, ethers } from "ethers";
import {
  Interface,
  arrayify,
  computePublicKey,
  joinSignature,
  keccak256,
  parseEther,
  recoverAddress,
  recoverPublicKey,
  splitSignature,
  verifyMessage,
} from "ethers/lib/utils.js";
import { SiweMessage } from "siwe";
import { Connector, serialize, useAccount, useBalance, useConnect, useDisconnect, useProvider, useSigner } from "wagmi";
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

export default function Wallet() {
  const domain = "localhost:3000";
  const redirectUri = "https://localhost:3000/lit";

  const { data: nftContract } = useDeployedContractInfo("ERC721e");
  const { data: signer } = useSigner();

  const provider = useProvider();

  let ctxInstance: ethers.Contract;

  if (nftContract) {
    ctxInstance = new ethers.Contract(nftContract?.address, nftContract?.abi, signer || provider);
  }
  const router = useRouter();
  const chainName = "mumbai";

  const [view, setView] = useState<Views>(Views.SIGN_IN);
  const [error, setError] = useState<any>();

  const [litAuthClient, setLitAuthClient] = useState<LitAuthClient>();
  const [litNodeClient, setLitNodeClient] = useState<LitNodeClient>();
  const [currentProviderType, setCurrentProviderType] = useState<ProviderType>();
  const [authMethod, setAuthMethod] = useState<AuthMethod>();
  const [pkps, setPKPs] = useState<IRelayPKP[]>([]);
  const [currentPKP, setCurrentPKP] = useState<IRelayPKP>();
  const [sessionSigs, setSessionSigs] = useState<SessionSigs>();
  const [authSig, setAuthSig] = useState<AuthSig>();

  const [message, setMessage] = useState<string>("Free the web!");
  const [signature, setSignature] = useState<string>();
  const [recoveredAddress, setRecoveredAddress] = useState<string>();
  const [verified, setVerified] = useState<boolean>(false);

  const [addressReceiver, setAddressReceiver] = useState<string>("");
  const [amountToSend, setAmountToSend] = useState<string>("0.1");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const [nftId, setNftId] = useState<number[]>([]);

  const decryptInfo = "Click the Decrypt button below to decrypt the NFT description.";
  const noAuthError = "You should have at least 0.1 MATIC to decrypt the description! Try again.";
  const otherError = "Some unexpected error occurred. Please try again!";

  const [descriptionDecrypted, setDescriptionDecrypted] = useState(decryptInfo);
  const [tempCode, setTempCode] = useState(0);

  const [nfts, setNfts] = useState<any>();

  const { data: balance } = useBalance({
    address: currentPKP?.ethAddress,
    chainId: 80001,
    formatUnits: "ether",
  });

  const accessControlConditions = [
    {
      contractAddress: "",
      standardContractType: "",
      chain: chainName,
      method: "eth_getBalance",
      parameters: [":userAddress", "latest"],
      returnValueTest: {
        comparator: ">=",
        value: "10000000000000",
      },
    },
  ];

  useEffect(() => {
    setDescription(decryptInfo);
  }, [nfts]);

  // Use wagmi to connect one's eth wallet
  const { connectAsync, connectors } = useConnect({
    onError(error) {
      console.error(error);
      setError(error);
    },
  });
  const { isConnected, connector, address } = useAccount();
  const { disconnectAsync } = useDisconnect();

  const sendSignedTransaction = async (
    signedTransaction: number | ethers.utils.BytesLike | ethers.utils.Hexable,
    provider: P,
  ) => {
    const bytes: any = ethers.utils.arrayify(signedTransaction);
    return await provider.sendTransaction(bytes);
  };

  async function createSiwe(address: string, statement: string) {
    const domain = "localhost:3000";
    const origin = "http://localhost:3000/lit";

    const siweMessage = new SiweMessage({
      domain,
      address: address,
      statement,
      uri: origin,
      version: "1",
      chainId: 80001,
    });

    console.log("siweMessage", siweMessage);

    const messageToSign = siweMessage.prepareMessage();
    console.log("messageToSign", messageToSign);

    return messageToSign;
  }

  async function sendETHWithPKP() {
    console.log("Current PKP", currentPKP);

    const tx = {
      to: addressReceiver,
      nonce: await provider.getTransactionCount(currentPKP?.ethAddress!),
      value: parseEther(amountToSend),
      gasPrice: await provider.getGasPrice(),
      gasLimit: 5000000,
      chainId: (await provider?.getNetwork()).chainId,
      data: "",
    };

    const serializedTx = ethers.utils.serializeTransaction(tx);
    const toSign = ethers.utils.arrayify(ethers.utils.keccak256(serializedTx));
    const message = serializedTx;

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

    const encodedSplitSig = splitSignature({
      r: "0x" + result.r,
      s: "0x" + result.s,
      v: result.recid,
    });

    setSignature(encodedSig);
    console.log("signature", encodedSig);

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
    setRecoveredAddress(recoveredAddr);
    console.log("recoveredAddr", recoveredAddr);

    // Check if the address associated with the signature is the same as the current PKP
    const verified = currentPKP?.ethAddress.toLowerCase() === recoveredAddr.toLowerCase();
    setVerified(verified);
    console.log("verified", verified);

    const signedTransaction = ethers.utils.serializeTransaction(tx, encodedSig);
    console.log("signedTransaction", signedTransaction);

    await sendSignedTransaction(signedTransaction, provider);
  }

  /**
   * Use wagmi to connect one's eth wallet and then request a signature from one's wallet
   */
  async function handleConnectWallet(c: any) {
    const { account, chain, connector } = await connectAsync(c);
    try {
      await authWithWallet(account, connector);
    } catch (err) {
      console.error(err);
      setError(err);
      setView(Views.ERROR);
    }
  }

  /**
   * Begin auth flow with Google
   */
  async function authWithGoogle() {
    setCurrentProviderType(ProviderType.Google);
    const provider = litAuthClient.initProvider<GoogleProvider>(ProviderType.Google);
    await provider.signIn();
  }

  /**
   * Begin auth flow with Discord
   */
  async function authWithDiscord() {
    setCurrentProviderType(ProviderType.Discord);
    const provider = litAuthClient.initProvider<DiscordProvider>(ProviderType.Discord);
    await provider.signIn();
  }

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

  async function registerWithWebAuthn() {
    setView(Views.REGISTERING);

    try {
      // Register new PKP
      const provider = litAuthClient.getProvider(ProviderType.WebAuthn) as WebAuthnProvider;
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
  }

  async function authenticateWithWebAuthn() {
    setView(Views.AUTHENTICATING);

    try {
      const provider = litAuthClient?.getProvider(ProviderType.WebAuthn) as WebAuthnProvider;
      const authMethod = await provider.authenticate();
      setAuthMethod(authMethod);

      // Authenticate with a WebAuthn credential and create session sigs with authentication data
      setView(Views.CREATING_SESSION);

      const sessionSigs = await provider.getSessionSigs({
        pkpPublicKey: currentPKP?.publicKey!,
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
      setAuthMethod(null);
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
        let provider: BaseProvider;
        if (providerName === ProviderType.Google) {
          provider = litAuthClient?.getProvider(ProviderType.Google);
        } else if (providerName === ProviderType.Discord) {
          provider = litAuthClient?.getProvider(ProviderType.Discord);
        }
        setCurrentProviderType(providerName as ProviderType);

        // Get auth method object that has the OAuth token from redirect callback
        const authMethod: AuthMethod = await provider.authenticate();
        setAuthMethod(authMethod);

        // Fetch PKPs associated with social account
        setView(Views.FETCHING);
        const pkps: IRelayPKP[] = await provider.fetchPKPsThroughRelayer(authMethod);

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
        tokenId: response.pkpTokenId,
        publicKey: response.pkpPublicKey,
        ethAddress: response.pkpEthAddress,
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
      handleRedirect(providerName);
    }
  }, [litAuthClient, handleRedirect, authMethod]);

  if (!litNodeClient) {
    return null;
  }

  const closeModalAndRemoveContents = () => {
    setName("");
    setDescription("");
    setImageUrl("");
  };

  return (
    <>
      <Head>
        <title>Lit Auth Client</title>
        <meta name="description" content="Create a PKP with just a Google account" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="flex items-center flex-col pt-10 text-center">
        {view === Views.ERROR && (
          <>
            <h1>Error</h1>
            <p>{error.message}</p>
            <button
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
            <h1>Sign in with Lit</h1>
            {/* Since eth wallet is connected, prompt user to sign a message or disconnect their wallet */}
            <>
              {isConnected ? (
                <>
                  <button
                    disabled={!connector.ready}
                    key={connector.id}
                    onClick={async () => {
                      setError(null);
                      //await authWithWallet(address, connector);
                      await handleConnectWallet({ connector });
                    }}
                  >
                    Continue with {connector.name}
                  </button>
                  <button
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
                  <button onClick={authWithGoogle}>Google</button>
                  <button onClick={authWithDiscord}>Discord</button>
                  {connectors.map(connector => (
                    <button
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
                  <button onClick={registerWithWebAuthn}>Register with WebAuthn</button>
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
            <h1>Check your wallet</h1>
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
            <h1>Fetching your PKPs...</h1>
          </>
        )}
        {view === Views.FETCHED && (
          <>
            {pkps.length > 0 ? (
              <>
                <h1>Select a PKP to continue</h1>
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
            <h1>Minting your PKP...</h1>
          </>
        )}
        {view === Views.MINTED && (
          <>
            <h1>Minted!</h1>
          </>
        )}
        {view === Views.CREATING_SESSION && (
          <>
            <h1>Saving your session...</h1>
          </>
        )}
        {view === Views.SESSION_CREATED && (
          <>
            <h1 className="text-6xl font-bold">WAL.LIT</h1>
            <div>
              <p className="text-xl font-semibold">{currentPKP?.ethAddress}</p>
              <p className="text-lg font-semibold"> 💲 {balance?.formatted}</p>
            </div>
            <div className="w-fit">
              <p>Select PKP</p>
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
            <hr></hr>
            <div className="bg-secondary m-5 p-5 border-1 rounded-xl">
              <p className="text-2xl text-left">Send ETH</p>
              <input
                value={amountToSend}
                onChange={e => setAmountToSend(e.target.value)}
                className="input input-bordered w-full mb-4"
                type="text"
                required
                placeholder="Enter amount to send"
              />
              <input
                value={addressReceiver}
                onChange={e => setAddressReceiver(e.target.value)}
                className="input input-bordered w-full mb-4"
                type="text"
                required
                placeholder="Receiver "
              />
              <button onClick={sendETHWithPKP} className="btn btn-primary">
                Send ETH
              </button>
            </div>
            <div className="bg-secondary m-5 p-5 border-1 rounded-xl">
              <p className="text-2xl">Write a message and Sign it with your PKP</p>
              <textarea
                onChange={e => setMessage(e.target.value)}
                className="input input-bordered w-96 p-2 my-2"
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
                  <p className="break-all">{signature}</p>
                  <h2 className="text-lg">Recovered address</h2>
                  <p className="font-bold">{recoveredAddress}</p>
                  <h3>Verified</h3>
                  <p className="font-bold">{verified ? "true" : "false"}</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
