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
import { Connector, serialize, useAccount, useConnect, useDisconnect, useProvider, useSigner } from "wagmi";
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
  MINT_NFT = "mint_nft",
  ERROR = "error",
  DECRYPT = "decrypt",
}

export default function Nft() {
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

  async function getAuthSign() {
    // Create a function to handle signing messages
    const _signer = await connector?.getSigner();
    console.log("signer", _signer);

    const messageToSign = await createSiwe(_signer._address, "Free the web!");

    const signature = await _signer.signMessage(messageToSign);
    console.log("signature", signature);

    const recoveredAddress = ethers.utils.verifyMessage(messageToSign, signature);
    console.log("recoveredAddress", recoveredAddress);

    const authSig = {
      sig: signature,
      derivedVia: "web3.eth.personal.sign",
      signedMessage: messageToSign,
      address: recoveredAddress,
    };

    setAuthSig(authSig);
  }

  async function encryptText(text: string) {
    const { encryptedString, symmetricKey } = await encryptString(text);
    console.log("Encrypted string: ", encryptedString);
    getAuthSign();
    // Get auth sig

    const encryptedSymmetricKey = await litNodeClient?.saveEncryptionKey({
      accessControlConditions: accessControlConditions,
      symmetricKey,
      authSig: authSig,
      chain: chainName,
    });

    //provider.signEthereum;

    return {
      encryptedString,
      encryptedSymmetricKey: uint8arrayToString(encryptedSymmetricKey!, "base16"),
    };
  }

  async function decryptText(encryptedString: Blob, encryptedSymmetricKey: any) {
       
    const _signer = await connector?.getSigner();
        
    await getAuthSign();
              
    try {
      console.log("Encrypted string:", encryptedString);
      console.log("Encrypted symmetric key:", encryptedSymmetricKey);

      console.log("Session Sigs:", sessionSigs);
      console.log("Auth Sig:", authSig);

      const symmetricKey = await litNodeClient?.getEncryptionKey({
        accessControlConditions: accessControlConditions,
        toDecrypt: encryptedSymmetricKey,
        authSig: authSig,
        chain: chainName,
      });

      console.log("Symmetric key:", symmetricKey);

      return await decryptString(encryptedString, symmetricKey!);
    } catch (error) {
      console.error("Error in decryptText:", error);
      throw error;
    }
  }

  async function mintERC721e() {
    const { encryptedString, encryptedSymmetricKey } = await encryptText(description);
    console.log("Encrypted string:", encryptedString);
    console.log("Encrypted symmetric key:", encryptedSymmetricKey);

    const blobToBase64 = (blob: Blob) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      return new Promise(resolve => {
        reader.onloadend = () => {
          resolve(reader.result);
        };
      });
    };
    const encryptedDescriptionString = await blobToBase64(encryptedString);

    // Convert encryptedSting Blob solidty string types

    const contract = new ethers.Contract(nftContract?.address!, nftContract?.abi!, signer || provider);
    const tx = await contract.mintERC721e(name, imageUrl, encryptedDescriptionString, encryptedSymmetricKey);

    const _nfts = await ctxInstance.fetchNfts();
    setNfts(_nfts);
  }

  const decryptDescription = async (
    encryptedDescriptionString: RequestInfo | URL,
    encryptedSymmetricKeyString: any,
  ) => {
    console.log("Encrypted description string:", encryptedDescriptionString);
    console.log("Encrypted symmetric key string:", encryptedSymmetricKeyString);
    console.log("Session Sigs:", sessionSigs);

    // Convert base64 to blob to pass in the litSDK decrypt function
    const encryptedDescriptionBlob = await (await fetch(encryptedDescriptionString)).blob();

    let decryptedDescription;

    try {
      console.log("Decrypting description...");
      decryptedDescription = await decryptText(encryptedDescriptionBlob, encryptedSymmetricKeyString);
      setDescription(decryptedDescription);
    } catch (error) {
      if (error.errorCode === "incorrect_access_control_conditions") {
        decryptedDescription = noAuthError;
        notification.error(noAuthError)
      } else {
        decryptedDescription = otherError;
        notification.error(otherError)

      }
    }
    return decryptedDescription;
  };

  const handleDecryptDescription = async (
    encryptedDescriptionString: RequestInfo | URL,
    encryptedSymmetricKeyString: any,
    index: number,
  ) => {
    const result = await decryptDescription(encryptedDescriptionString, encryptedSymmetricKeyString);
    setTempCode(index);
  };

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
    setView(Views.MINT_NFT);
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

      setView(Views.MINT_NFT);
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
        setView(Views.MINT_NFT);
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

      setView(Views.MINT_NFT);

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
      <main>
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
                    setView(Views.MINT_NFT);
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
                      await authWithWallet(address, connector);
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

        {view === Views.SESSION_CREATED && (
          <>
            <h1>Ready for the open web</h1>
            <div>
              <p>Check out your PKP:</p>
              <p>{currentPKP?.ethAddress}</p>
            </div>
            <hr></hr>
            <div>
              <p>Sign this message with your PKP:</p>
              <p>{message}</p>
              <button onClick={signMessageWithPKP}>Sign message</button>

              {signature && (
                <>
                  <h3>Your signature:</h3>
                  <p>{signature}</p>
                  <h3>Recovered address:</h3>
                  <p>{recoveredAddress}</p>
                  <h3>Verified:</h3>
                  <p>{verified ? "true" : "false"}</p>
                </>
              )}
            </div>
          </>
        )}
        {view === Views.MINT_NFT && (
          <>
            <div className="flex items-center flex-col flex-grow pt-10">
              <h1>Encrypt & Decrypt an On-Chain NFT Metadata using Lit SDK</h1>
              Access Control Condition: >= 0.1 MATIC
              
              {nftContract && (
                <div className="m-5">
                  <div className="flex flex-row gap-2">
                    <button
                      id="mintButton"
                      onClick={async () => {
                        const nfts = await ctxInstance.fetchNfts();
                        console.log(nfts);
                        setNfts(nfts);
                      }}
                      className="btn btn-primary"
                    >
                      Fetch nft
                    </button>
                    <label htmlFor="mintNft" className="btn btn-primary">
                      Mint Nft
                    </label>
                    <input type="checkbox" id="mintNft" className="modal-toggle" />
                    <div className="modal">
                      <div className="modal-box">
                        <h2 className="text-xl font-bold mb-4">Enter NFT Details</h2>
                        <input
                          value={name}
                          className="input input-bordered w-full mb-4"
                          type="text"
                          required
                          placeholder="Name"
                          onChange={e => setName(e.target.value)}
                        />
                        <textarea
                          value={description}
                          className="textarea textarea-bordered w-full mb-4"
                          type="text"
                          required
                          onChange={e => setDescription(e.target.value)}
                          placeholder="Description"
                        />
                        <input
                          value={imageUrl}
                          className="input input-bordered w-full mb-4"
                          type="text"
                          required
                          placeholder="Image URL"
                          onChange={e => setImageUrl(e.target.value)}
                        />
                        <div className="modal-action">
                          <button
                            id="mintButton"
                            disabled={!name || !description || !imageUrl}
                            onClick={async () => {
                              await mintERC721e();
                              closeModalAndRemoveContents();
                            }}
                            className="btn"
                          >
                            Mint
                          </button>

                          <label htmlFor="mintNft" className="btn" onClick={closeModalAndRemoveContents}>
                            Yay!
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {nfts && (
                <div className="w-96">
                  <h1 className="text-center">My NFTs</h1>
                  <span className="m-2" />
                  <div className="w-96">
                    {nfts.map((nft: any, index: number) => (
                      <div className=" card card-compact bg-base-300 p-5 m-5" key={index}>
                        <div className="card card-title ">
                          <p>{nft.name}</p>
                        </div>
                        <div className="card card-body">
                          <p>{nft.imageUrl}</p>
                        </div>
                        <div className="card card-actions">
                          <button
                            className="btn btn-primary"
                            onClick={async () => {
                              handleDecryptDescription(nft.encryptedDescription, nft.encryptedSymmetricKey, index);
                            }}
                          >
                            Decrypt
                          </button>{" "}
                          <button
                            className="btn btn-primary"
                            onClick={async () => {
                              handleDecryptDescriptionPKP(nft.encryptedDescription, nft.encryptedSymmetricKey, index);
                            }}
                          >
                            Decrypt With PKP
                          </button>{" "}
                        </div>
                        {index == tempCode && (
                          <div className="card card-body">
                            <div className="font-semibold text-2xl">{description}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
