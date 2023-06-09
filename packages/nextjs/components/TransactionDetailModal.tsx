import React from "react";
import { Address, Balance } from "./scaffold-eth/";
import { Button, Modal } from "antd";

//import { ethers } from "ethers";

export default function TransactionDetailsModal({
  open,
  handleOk,
  handleCancel,
  mainnetProvider,
  price,
  txnInfo = null,
  showFooter = false,
}) {
  return (
    <Modal
      title="Transaction Details"
      open={open}
      onCancel={handleCancel}
      destroyOnClose
      onOk={handleOk}
      closable
      maskClosable
      /* txnInfo */
      footer={
        showFooter
          ? [
              <Button key="cancel" onClick={handleCancel}>
                Cancel
              </Button>,
              <Button key="ok" onClick={handleOk}>
                Submit
              </Button>,
            ]
          : null
      }
    >
     {/*  {txnInfo && (
        <div>
          <p>
            <b>Event Name :</b> {txnInfo.functionFragment.name}
          </p>
          <p>
            <b>Function Signature :</b> {txnInfo.signature}
          </p>
          <h4>Arguments :&nbsp;</h4>
          {txnInfo.functionFragment.inputs.map((element, index) => {
            if (element.type === "address") {
              return (
                <div
                  key={element.name}
                  style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "left" }}
                >
                  <b>{element.name} :&nbsp;</b>
                  <Address fontSize={16} address={txnInfo.args[index]} ensProvider={mainnetProvider} />
                </div>
              );
            } else if (element.type === "uint256") {
              return (
                <p key={element.name}>
                  {element.name === "value" ? (
                    <>
                      <b>{element.name} : </b>{" "}
                      <Balance fontSize={16} balance={txnInfo.args[index]} dollarMultiplier={price} />{" "}
                    </>
                  ) : (
                    <>
                      <b>{element.name} : </b> {txnInfo.args[index] && txnInfo.args[index].toNumber()}
                    </>
                  )}
                </p>
              );
            } else {
              return (
                <p key={element.name}>
                  {
                    <>
                      <b>{element.name} : </b> {txnInfo.args[index]}
                    </>
                  }
                </p>
              );
            }
          })}
          <p>
            <b>SigHash : &nbsp;</b>
            {txnInfo.sighash}
          </p>
        </div>
      )} */}
    </Modal>
  );
}
