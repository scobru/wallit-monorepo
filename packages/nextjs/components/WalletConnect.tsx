import { Fragment, useState } from "react";
import QrReader from "../components/QrReader";
import { createLegacySignClient } from "../utils/LegacyWalletConnectUtil";
import { signClient } from "../utils/WalletConnectUtil";
import { parseUri } from "@walletconnect/utils";

export const WalletConnect = () => {
  const [uri, setUri] = useState("");
  const [loading, setLoading] = useState(false);

  async function onConnect(uri: string) {
    try {
      setLoading(true);
      const { version } = parseUri(uri);

      if (version === 1) {
        const result = createLegacySignClient({ uri });
        console.log(result);
      } else {
        const result = await signClient.pair({ uri });
        console.log(result);
      }
    } catch (err: unknown) {
      alert(err);
    } finally {
      setUri("");
      setLoading(false);
    }
  }

  return (
    <div className="flex ">
      <button className="btn btn-primary" onClick={() => onConnect(uri)}>
        Connect
      </button>
      <QrReader onConnect={onConnect} />
      or use walletconnect uri
      <input
        className="form-control"
        placeholder="e.g. wc:a281567bb3e4..."
        onChange={e => setUri(e.target.value)}
        value={uri}
      />
    </div>
  );
};
