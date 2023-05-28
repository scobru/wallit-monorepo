import { SetStateAction, useEffect, useState } from "react";
import { Signer, ethers, providers } from "ethers";
import { Interface, hexlify, parseEther, parseUnits } from "ethers/lib/utils.js";
import nacl from "tweetnacl";
import { multicall } from "@wagmi/core";
import { ProviderRpcError, erc20ABI, useAccount, useProvider, useSigner } from "wagmi";
import {
  useScaffoldContract,
  useScaffoldContractRead,
  useScaffoldContractWrite,
  useTransactor,
} from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth/notification";
import { Address } from "~~/components/scaffold-eth/Address";
import { ArchiveBoxIcon, ArrowDownCircleIcon, ArrowPathIcon, ArrowRightCircleIcon, ArrowUpCircleIcon } from "@heroicons/react/24/outline";
import { MetaMaskAvatar } from "react-metamask-avatar";
import { QRCodeCanvas } from "qrcode.react";
import WalletConnectInput from "~~/components/WalletConnectInput";

export default function CreateWalletPage() {
  enum Views {
    CREATE_WALLET,
    SET_PASSWORD,
    SESSION_CREATED,
  }

  type KeyPair = {
    encryptedKey: string;
    publicKey: string;
    name: string;
  };

  const { data: signer } = useSigner();
  const account = useAccount();
  const provider = useProvider();
  const txData = useTransactor();
  const block = provider?.getBlockNumber();
  const chainId = provider?.network?.chainId;

  const [wallet, setWallet] = useState<ethers.Wallet>();
  const [walletSigner, setWalletSigner] = useState<Signer>();
  const [encryptedKey, setEncryptedKey] = useState<{}>();
  const [password, setPassword] = useState<string>();
  const [view, setView] = useState<Views>(Views.CREATE_WALLET);
  const [name, setName] = useState<string>();
  const [keys, setKeys] = useState<KeyPair[]>([]);
  const [balance, setBalance] = useState<string>();
  const [tokenList, setTokenList] = useState<string[]>([]);
  const [tokenInWallet, setTokenInWallet] = useState<string[]>([]);
  const zapperUrl = "https://zapper.xyz/account/" + wallet?.address || undefined;
  const qrCodeUrl = "ethereum:" + wallet?.address + "/pay?chain_id=137value=0";
  const [customTx, setCustomTx] = useState<string>();
  const [tokenToApprove , setTokenToApprove] = useState<string>();
  const [wcAmount, setWcAmount] = useState<string>();
  const [wcTo, setWcTo] = useState<string>();
  const [wcCustomCallData, setWcCustomCallData] = useState<string>();
  const [isWalletConnectTransaction, setIsWalletConnectTransaction] = useState<boolean>(false);
  const [parsedCustomCallData, setParsedCustomCallData] = useState(null);

  const [tokenId, setTokenId] = useState<string>();
  const [selectedKey, setSelectedKey] = useState<KeyPair>();

  const [receiver, setReceiver] = useState<string>();
  const [amountToSend, setAmountToSend] = useState<string>();

  const ctx = useScaffoldContract({
    contractName: "KeyRegistry",
    signerOrProvider: signer || provider,
  });

  console.log("Contract: ", ctx);

  const getTokenIds = useScaffoldContractRead({
    contractName: "KeyRegistry",
    functionName: "getTokenIds",
    args: [account.address],
  });

  //////////////////////////////////////////////////////////////
  // Metodi per la creazione del Wallet
  //////////////////////////////////////////////////////////////

  const createWallet = async () => {
    const _wallet = ethers.Wallet.createRandom();
    console.log("New Wallet: ", _wallet);
    setWallet(_wallet);
    setView(Views.SET_PASSWORD);
  };

  const fetchKeys = async () => {
    const tokenIds: any = getTokenIds?.data?.map((tokenId: any) => tokenId.toString());
    let _keyPairArray: { encryptedKey: string; publicKey: string; name: string }[] = [];

    for (let i = 0; i < tokenIds?.length; i++) {
      const currentTokenId = tokenIds[i];

      setTokenId(currentTokenId);
      const keyPair = await ctx?.data?.getKeyPair(account.address, currentTokenId);

      const _keyPair = { encryptedKey: keyPair[0], publicKey: keyPair[1], name: keyPair[2] };
      _keyPairArray[i] = _keyPair;
    }
    setKeys(_keyPairArray);
    console.log("Keys: ", _keyPairArray);
  };

  //////////////////////////////////////////////////////////////
  // Metodi per la criptazione del Wallet
  //////////////////////////////////////////////////////////////

  const encodeBase64 = (data: WithImplicitCoercion<ArrayBuffer | SharedArrayBuffer>) => {
    return Buffer.from(data).toString("base64");
  };

  const decodeBase64 = (data: WithImplicitCoercion<string> | { [Symbol.toPrimitive](hint: "string"): string }) => {
    return Buffer.from(data, "base64");
  };

  function hexToUint8Array(hexString: string) {
    if (hexString.length % 2 !== 0) {
      throw "Invalid hexString";
    }
    var arrayBuffer = new Uint8Array(hexString.length / 2);

    for (let i = 0; i < hexString.length; i += 2) {
      var byteValue = parseInt(hexString.substr(i, 2), 16);
      if (isNaN(byteValue)) {
        throw "Invalid hexString";
      }
      arrayBuffer[i / 2] = byteValue;
    }
    return arrayBuffer;
  }

  const encryptWallet = async () => {
    console.log("Encrypting Wallet...");
    console.log("Wallet: ", wallet);
    console.log("Password: ", password);

    if (!wallet || !password) return;

    // convert to base64
    const secretKey = decodeBase64("francos");
    const secretKeyUint8 = new Uint8Array(nacl.secretbox.keyLength);
    secretKeyUint8.set(secretKey.subarray(0, nacl.secretbox.keyLength));

    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    //const messageUint8 = decodeBase64(wallet.privateKey);
    const messageUint8 = hexToUint8Array(wallet.privateKey.slice(2));
    const box = nacl.secretbox(messageUint8, nonce, secretKeyUint8);

    const _encryptedKey = { box: encodeBase64(box), nonce: encodeBase64(nonce) };
    console.log("Encrypted Key: ", _encryptedKey);
    setEncryptedKey(_encryptedKey);

    txData(await ctx?.data?.registerKey(JSON.stringify(_encryptedKey), wallet?.address, name));
    console.log("Keys: ", keys);

    setView(Views.SESSION_CREATED);
    await fetchKeys();
  };

  const loadWallet = async (_kp: KeyPair) => {
    setWallet(undefined);
    setSelectedKey(_kp);

    console.log("Loading Wallet...");
    console.log("KeyPair: ", _kp);

    const secretKey = decodeBase64("francos");
    const secretKeyUint8 = new Uint8Array(nacl.secretbox.keyLength);
    secretKeyUint8.set(secretKey.subarray(0, nacl.secretbox.keyLength));

    const encryptedKey = JSON.parse(_kp.encryptedKey);
    const nonce = decodeBase64(encryptedKey.nonce);
    const box = decodeBase64(encryptedKey.box);

    const decrypted = nacl.secretbox.open(box, nonce, secretKeyUint8);

    if (!decrypted) {
      console.error("Failed to decrypt the key");
      return;
    }
    console.log("Decrypted: ", decrypted);

    // Convert decrypted Uint8Array into hexadecimal string
    let privateKey = encodeBase64(decrypted);

    // remove == from the end of the string and fix padding
    privateKey = hexlify(decrypted);

    console.log("Private Key: ", privateKey);

    // Create a new Wallet with the private key
    const _wallet = new ethers.Wallet(privateKey);
    console.log("Wallet: ", _wallet);

    setWallet(_wallet);

    let walletSigner = wallet?.connect(provider);
    console.log("WalletSigner: ", walletSigner);

    setWalletSigner(walletSigner);
    setView(Views.SESSION_CREATED);

  };

  async function sendETH() {
    const id = notification.info("Sending ETH");

    const tx = {
      to: receiver,
      nonce: await provider.getTransactionCount(wallet?.address as string),
      value: parseEther(amountToSend),
      gasPrice: await provider.getGasPrice(),
      gasLimit: 500000,
      chainId: (await provider?.getNetwork()).chainId,
      data: "",
    };

    console.log("tx:", tx);
    notification.remove(id);

    walletSigner?.sendTransaction(tx).then(transaction => {
      console.dir(transaction);
      notification.success("Send finished!");
    });
  }

  async function sendERC20() {
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
    const data = iface.encodeFunctionData("transfer", [receiver, _amountToSend]);

    const tx = {
      to: tokenToApprove,
      nonce: await provider.getTransactionCount(wallet.address as string),
      value: 0,
      gasPrice: await provider.getGasPrice(),
      gasLimit: 5000000,
      chainId: (await provider?.getNetwork()).chainId,
      data: data,
    };

    console.log("tx:", tx);
    notification.remove(id);

    walletSigner?.sendTransaction(tx).then(transaction => {
      console.dir(transaction);
      notification.success("Send finished!");
    });
  }

  async function approveERC20() {
    const id = notification.info("Approving ERC20 Token");

    const iface = new Interface(["function approve(address,uint256) returns (bool)"]);
    const data = iface.encodeFunctionData("approve", [receiver, parseEther(amountToSend)]);

    console.log("data", data);

    const tx = {
      to: tokenToApprove,
      nonce: await provider.getTransactionCount(wallet.address as string),
      value: 0,
      gasPrice: await provider.getGasPrice(),
      gasLimit: 500000,
      chainId: (await provider?.getNetwork()).chainId,
      data: data,
    };

    console.log("tx:", tx);
    notification.remove(id);

    walletSigner?.sendTransaction(tx).then(transaction => {
      console.dir(transaction);
      notification.success("Send finished!");
    });
  }

  async function sendCustomTxWith() {
    const id = notification.info("Send Custom Transaction");

    const tx = {
      to: receiver,
      nonce: await provider.getTransactionCount(wallet.address as string),
      value: parseEther(amountToSend),
      gasPrice: await provider.getGasPrice(),
      gasLimit: 500000,
      chainId: (await provider.getNetwork()).chainId,
      data: "0x" + customTx,
    };

    console.log("tx:", tx);
    notification.remove(id);

    walletSigner?.sendTransaction(tx).then(transaction => {
      console.dir(transaction);
      notification.success("Send finished!");
    });
  }

  useEffect(() => {
    if (account.isDisconnected) {
      console.log("No Account or Signer");

      setWallet(undefined);
      setEncryptedKey(undefined);
      setName(undefined);
      setView(Views.CREATE_WALLET);
    }
  }, [account]);

  useEffect(() => {
    if (keys.length == 0 && account.isConnected && signer) {
      console.log("Account Connected");
      
      fetchKeys();
    }
  }, [signer]);

  useEffect(() => {
    if (ctx && signer && wallet?.address) {
      
      const contract = new ethers.Contract(String(wallet?.address), ctx.data?.interface, signer || provider);
      
      const getBalance = async () => {
        const _balance = await provider.getBalance(wallet?.address);
        console.log(["balance", _balance, ethers.utils.formatEther(_balance)]);
        setBalance(ethers.utils.formatEther(_balance));
      };
      
      getBalance();
    }
  }, [block, signer, provider]);

  /* useEffect(() => {
    if (password == undefined) {
      setView(Views.SET_PASSWORD);
    }
  }, [password]); */

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
    await fetchKeys();
    await fetchTokenList();
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
              args: [wallet?.address],
              chainId: chainId,
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

  const loadWalletConnectData = ({ to, value, data }) => {
    console.log(to, value, data);
    !value ? setWcAmount(parseEther("0")) : setWcAmount(value);
    setWcTo(to);
    setWcCustomCallData(data);
    setIsWalletConnectTransaction(true);
  };

  useEffect(() => {
    console.log(["Parsed Transaction", parsedCustomCallData]);
    const getParsedTransaction = async () => {
      const tx = {
        to: wcTo,
        nonce: await provider.getTransactionCount(wallet.address as string),
        value: wcAmount,
        gasPrice: await provider.getGasPrice(),
        gasLimit: 500000,
        chainId: (await provider?.getNetwork()).chainId,
        data: wcCustomCallData,
      };
      //const parsedTransaction = await parseExternalContractTransaction(wcto, wcCustomCallData);
      setParsedCustomCallData(tx);
    };

    getParsedTransaction();
  }, [isWalletConnectTransaction]);

  useEffect(() => {
    if (isWalletConnectTransaction && parsedCustomCallData) {
      const doTx = async () => {
        walletSigner?.sendTransaction(parsedCustomCallData).then(transaction => {
          console.dir(transaction);
          notification.success("Send finished!");
        })
        setIsWalletConnectTransaction(false);
      }
      doTx();
    }


  }, [isWalletConnectTransaction, parsedCustomCallData]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      {view === Views.CREATE_WALLET && (
        <>
          <div>
            <div className="flex flex-col items-center justify-center min-h-screen py-2">
              <button className="btn btn-primary" onClick={createWallet}>
                Crea un nuovo Wallet
              </button>
              Your Wallets:
              <div>
                {keys ? (
                  <select className="select select-bordered" onChange={e => loadWallet(keys[e.target.value])}>
                    {keys.map((key, index) => (
                      <option value={index}>{key.publicKey}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}
      {view === Views.SET_PASSWORD && (
        <>
          <div>
            <div className="flex flex-col items-center justify-center min-h-screen py-2">
              <input
                className="input input-primary my-5 "
                type="text "
                onChange={e => setName(e.target.value)}
                placeholder="Name of Your Wallet"
              />
              <input
                className="input input-primary "
                type="password"
                onChange={e => setPassword(e.target.value)}
                placeholder="Password per criptare il Wallet"
              />
              <button className="btn btn-primary my-10" onClick={encryptWallet}>
                Cripta la Chiave Privata
              </button>
            </div>
          </div>
          <div>
            {keys ? (
              <select className="select select-bordered" onChange={e => loadWallet(keys[e.target.value])}>
                {keys.map((key, index) => (
                  <option value={index}>{key.publicKey}</option>
                ))}
              </select>
            ) : null}
          </div>
        </>
      )}
      {view === Views.SESSION_CREATED && (
        <>
          <div>
            <div className="flex items-center flex-col flex-grow">
              <div className=" w-fit bg-gradient-to-tr mx-auto  from-base-100 to-secondary  rounded-lg  border-1  shadow-2xl  shadow-black">
                <div className="text-center items-center mx-auto px-5">
                  <div className="my-5">
                    <MetaMaskAvatar
                      address={String(wallet?.address)}
                      size={200}
                      className="hover:animate-spin"
                    />
                    <div className="text-6xl text-center font-extrabold Capitalize mb-2 hover:animate-zoom">
                      {selectedKey?.name}
                    </div>
                    <div className="text-6xl text-center font-extrabold Capitalize mb-2 hover:animate-zoom">
                      {null!}
                    </div>
                  </div>
                </div>
                <div>
                  {wallet?.address && (
                  <div className="w-fit mx-auto">
                    <Address address={wallet?.address } format="short" />
                  </div>
                  )}
                  <div className="items-center flex flex-row">
                    <p className="text-6xl font-light   hover:animate-pulse-fast  items-center text-center  mx-auto">
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
                    
                  </div>
                </div>
                <div className="flex-row mx-1">
                  <label htmlFor="send-modal" className="btn btn-circle m-5">
                    <ArrowRightCircleIcon className="hover:animate-zoom" height={30} width={30} />
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
                        onChange={e => setReceiver(e.target.value)}
                        className="input input-bordered w-full mb-4"
                        type="text"
                        required
                        placeholder="Receiver "
                      />

                      <button onClick={sendETH} className="btn btn-primary">
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

                      <button onClick={null} className="btn btn-primary mx-2">
                        Wrap ETH
                      </button>
                      <button onClick={null} className="btn btn-primary">
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
                        onChange={e => setReceiver(e.target.value)}
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
                      <button onClick={approveERC20} className="btn btn-primary mx-2">
                        Approve
                      </button>
                      <button onClick={sendERC20} className="btn btn-primary">
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
                    <ArrowDownCircleIcon className="hover:animate-zoom" height={30} width={30} />
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
                    <ArrowUpCircleIcon className="hover:animate-zoom" height={30} width={30} />
                  </label>
                  <input type="checkbox" id="customtx-modal" className="modal-toggle" />
                  <div className="modal">
                     <div className="modal-box">
                      <h3 className="font-bold text-lg m-2">Custom Tx</h3>

                      <input
                        onChange={e => setReceiver(e.target.value)}
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
                      <button onClick={sendCustomTxWith} className="btn btn-primary">
                        Send
                      </button>
                      <div className="modal-action">
                        <label htmlFor="customtx-modal" className="btn">
                          Close
                        </label>
                      </div>
                    </div>
                  </div>
                  <a href={zapperUrl!} target="_blank" className="btn btn-circle m-5" rel="noreferrer">
                    <ArchiveBoxIcon className="hover:animate-zoom" height={30} width={30} />
                  </a>
                </div>
                <div className="card card-compact rounded-none w-full mt-10 text-left bg-primary p-4 border-1 border-primary-focus ">
                  <div className="card-title text-2xl text-neutral">Wallet Connect</div>
                  <div className="card-body  w-full">
                    <WalletConnectInput
                      chainId={chainId}
                      address={wallet?.address}
                      loadWalletConnectData={loadWalletConnectData}
                      provider={provider}
                      price={0}
                      walletInstance={null}
                      sessionSigs={null}
                      currentPKP={null}
                      processTransaction={null}
                    />
                  </div>
                </div>

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
              
            </div>
            <div className="flex flex-col items-center justify-center min-h-screen py-2">
              <div>
                <div>
                  {keys ? (
                    <select className="select select-bordered" onChange={e => loadWallet(keys[e.target.value])}>
                      {keys.map((key, index) => (
                        <option value={index}>{key.publicKey}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
