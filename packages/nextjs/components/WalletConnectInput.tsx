/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import parseExternalContractTransaction from "../helpers/parseExternalContractTransaction";
import useLocalStorage from "../hooks/useLocalStorage";
import TransactionDetailsModal from "./TransactionDetailModal";
import { CameraOutlined, QrcodeOutlined } from "@ant-design/icons";
import { SignTypedDataVersion, recoverTypedSignature } from "@metamask/eth-sig-util";
import WalletConnect from "@walletconnect/client";
import { Badge, Button, Input } from "antd";
import { ethers } from "ethers";
import { Interface, parseEther, serializeTransaction } from "ethers/lib/utils.js";
import QrReader from "react-qr-reader";
import { convertHexToUtf8, getTransactionToSign } from "~~/helpers/helpers";

const WalletConnectInput = ({
  chainId,
  address,
  loadWalletConnectData,
  price,
  walletInstance,
  sessionSigs,
  currentPKP,
  provider,
  processTransaction,
}) => {
  const [walletConnectConnector, setWalletConnectConnector] = useLocalStorage("walletConnectConnector");
  const [walletConnectUri, setWalletConnectUri] = useLocalStorage("walletConnectUri", "");
  const [isConnected, setIsConnected] = useLocalStorage("isConnected", false);
  const [peerMeta, setPeerMeta] = useLocalStorage("peerMeta");
  const [data, setData] = useState();
  const [to, setTo] = useState();
  const [value, setValue] = useState();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [parsedTransactionData, setParsedTransactionData] = useState();
  const [scan, setScan] = useState(false);

  useEffect(() => {
    if (walletConnectUri) {
      console.log("[WalletConnectInput] walletConnectUri changed", walletConnectUri);
      setupAndSubscribe();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletConnectUri]);

  useEffect(() => {
    if (address) {
      console.log("[WalletConnectInput] address changed", address);
      resetConnection();
    }
  }, [address]);

  useEffect(() => {
    if (data && to) {
      decodeFunctionData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, to]);

  const setupAndSubscribe = () => {
    console.log("[WalletConnectInput] setupAndSubscribe");
    const connector = setupConnector();
    if (connector) {
      subscribeToEvents(connector);
      setWalletConnectConnector(connector);
    }
  };

  const setupConnector = () => {
    console.log("[WalletConnectInput] setupConnector");
    let connector;
    try {
      connector = new WalletConnect({ uri: walletConnectUri });
      console.log("[WalletConnectInput] connector", connector);
      return connector;
    } catch (error) {
      console.log("setupConnector error:", error);
      setWalletConnectUri("");
      return connector;
    }
  };

  const subscribeToEvents = (connector: WalletConnect) => {
    console.log("[WalletConnectInput] subscribeToEvents");

    if (connector.connected) {
      setIsConnected(true);
      console.log("Session successfully connected.");
    }

    connector.on("session_request", (error: any, payload: { params: { peerMeta: any }[] }) => {
      if (error) {
        throw error;
      }

      console.log("Event: session_request", payload);
      setPeerMeta(payload.params[0].peerMeta);

      connector.approveSession({
        accounts: [address],
        chainId,
      });

      if (connector.connected) {
        setIsConnected(true);
        console.log("Session successfully connected.");
      }
    });

    connector.on("call_request", async (error: any, payload: any) => {
      if (error) {
        throw error;
      }

      console.log("Event: call_request", payload);
      await parseCallRequest(payload);
    });

    connector.on("disconnect", (error: any, payload: any) => {
      if (error) {
        throw error;
      }

      console.log("Event: disconnect", payload);
      resetConnection();
    });
  };

  async function sendSignedTransaction(
    signedTransaction: number | ethers.utils.BytesLike | ethers.utils.Hexable,
    provider: P,
  ) {
    const bytes: any = ethers.utils.arrayify(signedTransaction);
    const tx = await provider.sendTransaction(bytes);

    return tx;
  }

  const parseCallRequest = async (payload: { params: any[]; method: string }) => {
    console.log("[WalletConnectInput] parseCallRequest", payload);
    const method = payload.method;
    let sig;

    if (
      method == "eth_signTypedData_v4" ||
      method == "eth_signTypedData" ||
      method == "eth_signTypedData_v3" ||
      method == "eth_signTypedData_v2"
    ) {
      sig = await signEthereumRequest(payload);
      // Verify signature
      const { types, domain, primaryType, message } = JSON.parse(payload.params[1]);

      console.log("types", types);
      console.log("domain", domain);
      console.log("primaryType", primaryType);
      console.log("message", message);

      if (domain.name == "Permit2") {
        // Build the transaction data
        const iface = new Interface(["function approve(address,address,uint160,uint48) returns (bool)"]);
        const data = iface.encodeFunctionData("approve", [
          message.details.token,
          message.spender,
          message.details.amount,
          message.sigDeadline,
        ]);

        console.log("data", data);

        const tx = {
          to: domain.verifyingContract,
          nonce: await provider.getTransactionCount(currentPKP?.ethAddress as string),
          value: 0,
          gasPrice: await provider.getGasPrice(),
          gasLimit: 500000,
          chainId: (await provider?.getNetwork()).chainId,
          data: data,
        };

        await processTransaction(tx);
      } else {
        const formattedTypes = Object.assign({}, types);
        if (formattedTypes.EIP712Domain) {
          delete formattedTypes.EIP712Domain;
        }

        const recoveredAddr = ethers.utils.verifyTypedData(domain, formattedTypes, message, sig);

        console.log("Check 1: Signed typed data V4 verified?", address.toLowerCase() === recoveredAddr.toLowerCase());
        console.log(JSON.parse(payload.params[1]));

        const recoveredAddr2 = recoverTypedSignature({
          data: JSON.parse(payload.params[1]),
          signature: sig,
          version: SignTypedDataVersion.V4,
        });

        console.log("Check 2: Signed typed data V4 verified?", address.toLowerCase() === recoveredAddr2.toLowerCase());
      }
    } else {
      const callData = payload.params[0];
      setValue(callData.value);
      setTo(callData.to);
      setData(callData.data);
      console.log("[WalletConnectInput] callData", callData);
      console.log("[WalletConnectInput] callData.value", callData.value);
      console.log("[WalletConnectInput] callData.to", callData.to);
    }
  };

  const decodeFunctionData = () => {
    try {
      const parsedTransactionData = parseExternalContractTransaction(to, data);
      console.log("[WalletConnectInput] parsedTransactionData", parsedTransactionData);
      //setParsedTransactionData(parsedTransactionData);

      setIsModalVisible(true);
    } catch (error) {
      console.log(error);
      setParsedTransactionData(null);
    }
  };

  const killSession = () => {
    console.log("ACTION", "killSession");
    if (walletConnectConnector.connected) {
      walletConnectConnector.killSession();
    }
  };

  const hideModal = () => setIsModalVisible(false);

  const handleOk = () => {
    loadWalletConnectData({
      data,
      to,
      value,
    });
    setIsModalVisible(false);
  };

  const resetConnection = () => {
    setWalletConnectUri("");
    setIsConnected(false);
    setWalletConnectConnector(null);
    setData();
    setValue();
    setTo();
  };

  async function signTypedData(msgParams: string) {
    const { types, domain, primaryType, message } = JSON.parse(msgParams);

    if (types.EIP712Domain) {
      delete types.EIP712Domain;
    }

    console.log("signTypedData", types, domain, primaryType, message);
    const signature = await walletInstance._signTypedData(domain, types, message);

    return signature;
  }

  async function signTypedDataLegacy(msgParams) {
    // https://github.com/MetaMask/eth-sig-util/blob/9f01c9d7922b717ddda3aa894c38fbba623e8bdf/src/sign-typed-data.ts#L435
    const messageHash = typedSignatureHash(msgParams);
    const sig = await this.runLitAction(ethers.utils.arrayify(messageHash), "sig1");
    const encodedSig = ethers.utils.joinSignature({
      r: "0x" + sig.r,
      s: "0x" + sig.s,
      v: sig.recid,
    });
    return encodedSig;
  }

  async function signEthereumRequest(payload: { params: any; method: any }) {
    const address = walletInstance.address;
    let addressRequested = null;
    let message = null;
    let msgParams = null;
    let txParams = null;
    let transaction = null;
    let result = null;

    switch (payload.method) {
      case "eth_sign":
        addressRequested = payload.params[0];
        if (address.toLowerCase() !== addressRequested.toLowerCase()) {
          throw new Error("PKPWallet address does not match address requested");
        }
        message = convertHexToUtf8(payload.params[1]);
        result = await walletInstance.signMessage(message);
        break;
      case "personal_sign":
        addressRequested = payload.params[1];
        if (address.toLowerCase() !== addressRequested.toLowerCase()) {
          throw new Error("PKPWallet address does not match address requested");
        }
        message = convertHexToUtf8(payload.params[0]);
        result = await walletInstance.signMessage(message);
        break;
      case "eth_signTypedData":
        // Double check version to use since signTypedData can mean V1 (Metamask) or V3 (WalletConnect)
        // References: https://docs.metamask.io/guide/signing-data.html#a-brief-history
        // https://github.com/WalletConnect/walletconnect-monorepo/issues/546
        if (ethers.utils.isAddress(payload.params[0])) {
          // V3 or V4
          addressRequested = payload.params[0];
          if (address.toLowerCase() !== addressRequested.toLowerCase()) {
            throw new Error("PKPWallet address does not match address requested");
          }
          msgParams = payload.params[1];
          result = await signTypedData(msgParams);
        } else {
          // V1
          addressRequested = payload.params[1];
          if (address.toLowerCase() !== addressRequested.toLowerCase()) {
            throw new Error("PKPWallet address does not match address requested");
          }
          msgParams = payload.params[0];
          result = await signTypedDataLegacy(msgParams);
        }
        break;
      case "eth_signTypedData_v1":
        // Params are flipped in V1 - https://medium.com/metamask/scaling-web3-with-signtypeddata-91d6efc8b290
        addressRequested = payload.params[1];
        if (address.toLowerCase() !== addressRequested.toLowerCase()) {
          throw new Error("PKPWallet address does not match address requested");
        }
        msgParams = payload.params[0];
        result = await signTypedDataLegacy(msgParams);
        break;
      case "eth_signTypedData_v3":
      case "eth_signTypedData_v4":
        addressRequested = payload.params[0];
        if (address.toLowerCase() !== addressRequested.toLowerCase()) {
          throw new Error("PKPWallet address does not match address requested");
        }
        msgParams = payload.params[1];
        result = await signTypedData(msgParams);
        break;
      case "eth_signTransaction":
        txParams = payload.params[0];
        addressRequested = txParams.from;
        if (address.toLowerCase() !== addressRequested.toLowerCase()) {
          throw new Error("PKPWallet address does not match address requested");
        }
        transaction = getTransactionToSign(txParams);
        result = await walletInstance.signTransaction(transaction);
        break;
      case "eth_sendTransaction": {
        txParams = payload.params[0];
        addressRequested = txParams.from;
        if (address.toLowerCase() !== addressRequested.toLowerCase()) {
          throw new Error("PKPWallet address does not match address requested");
        }
        transaction = getTransactionToSign(txParams);
        const signedTx = await walletInstance.signTransaction(transaction);
        result = await walletInstance.sendTransaction(signedTx);
        break;
      }
      case "eth_sendRawTransaction": {
        transaction = payload.params[0];
        result = await walletInstance.sendTransaction(transaction);
        break;
      }
      default:
        throw new Error(`Ethereum JSON-RPC signing method "${payload.method}" is not supported`);
    }

    return result;
  }

  return (
    <>
      {scan ? (
        <div
          style={{
            zIndex: 256,
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
          }}
          onClick={() => {
            setScan(false);
          }}
        >
          <QrReader
            delay={250}
            resolution={1200}
            onError={e => {
              console.log("SCAN ERROR", e);
              setScan(false);
            }}
            onScan={newValue => {
              if (newValue) {
                console.log("SCAN VALUE", newValue);
                setScan(false);
                setWalletConnectUri(newValue);
              }
            }}
            style={{ width: "100%" }}
          />
        </div>
      ) : (
        ""
      )}

      <Input.Group compact>
        <Input
          style={{ width: "calc(100% - 31px)", marginBottom: 20 }}
          placeholder="Paste WalletConnect URI"
          disabled={isConnected}
          value={walletConnectUri}
          onChange={e => setWalletConnectUri(e.target.value)}
          color="black"
        />
        <Button
          disabled={isConnected}
          onClick={() => setScan(!scan)}
          icon={
            <Badge count={<CameraOutlined style={{ fontSize: 9 }} />}>
              <QrcodeOutlined style={{ fontSize: 18 }} />
            </Badge>
          }
        />
      </Input.Group>

      {isConnected && (
        <>
          <div style={{ marginTop: 10 }}>
            <img src={peerMeta.icons[0]} style={{ width: 25, height: 25 }} />
            <p>
              <a href={peerMeta.url} target="_blank">
                {peerMeta.url}
              </a>
            </p>
          </div>
          <Button onClick={killSession} type="primary">
            Disconnect
          </Button>
        </>
      )}

      {isModalVisible && (
        <TransactionDetailsModal
          visible={isModalVisible}
          txnInfo={parsedTransactionData}
          handleOk={handleOk}
          handleCancel={hideModal}
          showFooter={true}
          mainnetProvider={provider}
          price={price}
        />
      )}
    </>
  );
};
export default WalletConnectInput;
