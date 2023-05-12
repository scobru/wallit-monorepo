import { getStrategyExecutionPlanAction } from "./get-strategy-execution-plan.action";
import { getUsdPriceAction } from "./get-usd-price.action";
import { ethers } from "ethers";
import { computeAddress } from "ethers/lib/utils.js";
import { erc20ABI } from "wagmi";

/**
 *
 * DISCLAIMER: THIS CODE IS STRICTLY FOR DEMONSTRATION PURPOSES ONLY.
 *
 * Some parts are still in heavy development and are not ready for production use.
 *
 * The code below can be divided into 4 parts:
 * - get the current price of a token in USD
 * - get the current portfolio balance
 * - get the strategy execution plan
 * - execute the strategy execution plan
 *
 * Each part can be run independently via a child lit action, and finally only sign
 * if conditions are met to execute the strategy execution plan, aka. swap tokens.
 *
 */

/**
 * It retrieves the current price of a specific symbol in USD. The symbol is passed as a parameter to the function. It uses the CryptoCompare API to fetch the price and returns the price data in the form of an object with a status field and a data field.
 *
 * @param { string } symbol eg. "ETH", "USDT", "DAI"
 * @return { { Response  } } eg. { status: 200, data: 1234.56 }
 */
export async function getUSDPrice(client: any, authSig: any, symbol: any) {
  console.log(`[Lit Action] Running Lit Action to get ${symbol}/USD price...`);

  const code = getUsdPriceAction;
  const res = await client.executeJs({
    targetNodeRange: 10,
    authSig: authSig!,
    code: code,
    jsParams: {
      tokenSymbol: symbol,
    },
  });

  console.log(`[Lit Action] Lit Action to get ${symbol}/USD price completed.`);
  console.log(res.response);
  return res.response;
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

export async function getPortfolio(authSig: any, client: any, tokens: any[], pkpAddress: any, provider: any) {
  console.log(`[Lit Action] [FAKE] Running Lit Action to get portfolio...`);

  // Using Promise.all, we retrieve the balance and value of each token in the `tokens` array.
  const balances = await Promise.all(
    tokens.map(async token => {
      console.log(token);
      const ERC20 = new ethers.Contract(token.address, erc20ABI, provider);

      // Get the token balance using the `ERC20.getBalance` method.
      let balance = await ERC20.balanceOf(pkpAddress);

      // Get the number of decimal places of the token using the `ERC20.getDecimals` method.
      const decimals = token.decimals;
      console.log("Decimals", decimals);

      // Format the token balance to have the correct number of decimal places.
      balance = parseFloat(ethers.utils.formatUnits(balance, decimals));

      // Get the token symbol using the `tokenSymbolMapper` or the original symbol if not found.
      const priceSymbol = token.symbol;

      // Get the token value in USD using the `getUSDPrice` function.
      const value = (await getUSDPrice(client, authSig, priceSymbol)).data * balance;

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

export async function getStrategyExecutionPlanMock(tokens: any[], strategy: string | any[]) {
  console.log("Strategy", Array(strategy));
  console.log("Tokens", Array(tokens));

  strategy = JSON.parse(strategy);
  tokens = JSON.parse(JSON.stringify(tokens));
  console.log("Strategy Array", strategy);

  // if the strategy percentage is not 100, throw an error
  if (strategy.reduce((sum, s) => sum + s.percentage, 0) !== 100) {
    // show which token can be adjusted with another percentage to make the total 100
    let tokenToAdjust = strategy.find(s => s.percentage !== 0);
    console.log("TokenToAdjust:", tokenToAdjust);

    let adjustedPercentage = 100 - strategy.reduce((sum, s) => sum + s.percentage, 0);
    console.log("AdjustedPercentage:", adjustedPercentage);

    let total = tokenToAdjust.percentage + adjustedPercentage;
    console.log("Total:", total);

    /*     throw new Error("error: strategy percentages must add up to 100.");
     */
  }

  // this will both set the response to the client and return the data internally
  const respond = data => {
    Lit.Actions.setResponse({
      response: JSON.stringify(data),
    });

    return data;
  };
  // Calculate the total value of the portfolio
  let totalValue = tokens.reduce((sum, token) => sum + token.value, 0);
  console.log("totalValue:", totalValue);
  // Calculate the target percentage for each token based on the strategy
  let targetPercentages = strategy.map(s => s.percentage / 100);
  console.log("targetPercentages:", targetPercentages);

  // Calculate the target value for each token
  let targetValues = targetPercentages.map(p => totalValue * p);
  console.log("targetValues:", targetValues);

  // Create a mapping between the token symbol and its index in the tokens array
  let tokenIndexMap = tokens.reduce((map, token, index) => {
    map[token.token.symbol] = index;
    return map;
  }, {});

  console.log("tokenIndexMap:", tokenIndexMap);

  // Calculate the difference between the target value and the current value for each token
  let diffValues = strategy.map((s, index) => {
    let tokenIndex = tokenIndexMap[s.token];
    return targetValues[index] - tokens[tokenIndex].value;
  });
  console.log("diffValues:", diffValues);

  // Determine which token to buy by finding the token with the largest negative difference
  let tokenToBuyIndex = diffValues.reduce(
    (maxIndex, diff, index) => (diff > diffValues[maxIndex] ? index : maxIndex),
    0,
  );
  console.log("tokenToBuyIndex:", tokenToBuyIndex);

  // Calculate the amount of the token to sell
  let percentageToSell = diffValues[tokenToBuyIndex] / tokens[tokenToBuyIndex].value;
  console.log("percentageToSell:", percentageToSell);

  // get the actual amount of token to sell
  let amountToSell = tokens[tokenToBuyIndex].balance * percentageToSell;
  console.log("amountToSell:", amountToSell);

  // Determine which token to sell by finding the token with the largest positive difference
  let tokenToSellIndex = diffValues.reduce(
    (minIndex, diff, index) => (diff < diffValues[minIndex] ? index : minIndex),
    0,
  );
  console.log("tokenToSellIndex:", tokenToSellIndex);

  const toSellSymbol = strategy[tokenToSellIndex].token;
  const toBuySymbol = strategy[tokenToBuyIndex].token;

  // find to sell token param tokens
  const toSellToken = tokens.find(token => token.token.symbol === toSellSymbol).token;

  //  find to buy token
  const toBuyToken = tokens.find(token => token.token.symbol === toBuySymbol).token;

  // calculate the percentage difference between the strategy and the current portfolio, and show which token is it
  const proposedAllocation = diffValues.map((diff, index) => {
    const percentageDiff = (diff / totalValue) * 100;
    const token = strategy[index].token;
    return { token, percentageDiff };
  });

  // sell allocation
  const sellPercentageDiff = proposedAllocation.find(token => {
    return token.token === toSellToken.symbol;
  });

  // Return the token to sell and the amount to sell
  return console.log({
    status: 200,
    data: {
      tokenToSell: toSellToken,
      percentageToSell: Math.abs(percentageToSell),
      amountToSell: amountToSell.toFixed(6).toString(),
      tokenToBuy: toBuyToken,
      proposedAllocation,
      valueDiff: {
        token: sellPercentageDiff.token,
        percentage: Math.abs(sellPercentageDiff.percentageDiff).toFixed(2),
      },
    },
  });
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
export async function getStrategyExecutionPlan(
  litNodeClient: any,
  serverAuthSig: any,
  portfolio: { token: any; balance: any; value: number }[],
  strategy: any,
) {
  console.log(`[Lit Action] Running Lit Action to get strategy execution plan...`);
  const code = getStrategyExecutionPlanAction;

  console.log("Portfolio: ", portfolio);
  console.log("Strategy: ", strategy);

  const res = await litNodeClient.executeJs({
    targetNodeRange: 1,
    authSig: serverAuthSig,
    code: code,
    jsParams: {
      portfolio,
      strategy,
    },
  });

  console.log("Lit Action Response: ", res);

  return res.response;
}

// -------------------------------------------------------------------
//          Let's pretend this function lives on Lit Action
// -------------------------------------------------------------------
const executeSwap = async ({ jsParams }) => {
  // --------------------------------------
  //          Checking JS Params
  // --------------------------------------

  const { tokenIn, tokenOut, pkp, authSig, amountToSell, provider, conditions } = jsParams;

  // if pkp.public key doesn't start with 0x, add it
  if (!pkp.publicKey.startsWith("0x")) {
    pkp.publicKey = "0x" + pkp.publicKey;
  }

  const pkpAddress = computeAddress(pkp.publicKey);

  // ------------------------------------------------------------------------------
  //          ! NOTE ! Let's pretend these functions works on Lit Action
  // ------------------------------------------------------------------------------
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

  const Lit = {
    Actions: {
      getGasPrice: () => provider.getGasPrice(),
      getTransactionCount: walletAddress => provider.getTransactionCount(walletAddress),
      getNetwork: () => provider.getNetwork(),
      sendTransaction: tx => provider.sendTransaction(tx),
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
  const getAllowance = async ({ tokenInAddress, pkpAddress, swapRouterAddress }) => {
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
  const txToMsg = tx => arrayify(keccak256(arrayify(serialize(tx))));

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
      const serialized = serialize(originalUnsignedTx, signedTxSignature);

      return await Lit.Actions.sendTransaction(serialized);
    } catch (e) {
      console.log(e);
      throw new Error("Error sending tx");
    }
  };

  /**
   * This will approve the swap
   */
  const approveSwap = async ({ swapRouterAddress, maxAmountToApprove = MaxUint256, tokenInAddress }) => {
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
      gasLimit: 150000,
      chainId,
      data: approveData,
    };

    const message = txToMsg(unsignedTx);

    // sign the tx (with lit action)
    const sigName = "approve-tx-sig";
    const res = await LitActions.call({
      code: Code.signEcdsa,
      authSig,
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
      gasLimit: 150000,
      chainId,
      data: swapData,
    };

    const message = txToMsg(unsignedTx);

    console.log(`[Swap] Signing with Lit Action...`);
    // sign the tx (with lit action)
    const sigName = "swap-tx-sig";
    const res = await LitActions.call({
      code: Code.signEcdsa,
      authSig,
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

  // get the allowance of the contract to spend the token
  const allowance = await getAllowance({
    tokenInAddress: tokenIn.address,
    pkpAddress,
    swapRouterAddress: SWAP_ROUTER_ADDRESS,
  });

  console.log("[ExecuteSwap] 1. allowance:", allowance.toString());

  // if it's NOT approved, then we need to approve the swap
  if (allowance <= 0) {
    console.log("[ExecuteSwap] 2. NOT approved! approving now...");
    await approveSwap({
      swapRouterAddress: SWAP_ROUTER_ADDRESS,
      tokenInAddress: tokenIn.address,
    });
  }

  console.log("[ExecuteSwap] 3. Approved! swapping now...");
  return await swap({
    swapRouterAddress: SWAP_ROUTER_ADDRESS,
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
export async function runBalancePortfolio({
  client,
  authSig,
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
  dryRun = true,
}) {
  // get execution time
  const startTime = new Date().getTime();

  // get current date and time in the format: YYYY-MM-DD HH:mm:ss in UK time
  const now = new Date().toLocaleString("en-GB");

  console.log(`[BalancePortfolio] => Start ${now}`);

  const pkpAddress = computeAddress(pkpPublicKey);

  // -- Portfolio --
  let portfolio = [];
  try {
    const res = await getPortfolio(authSig, client, tokens, pkpAddress, provider);
    portfolio = res.data;
  } catch (e) {
    const msg = `Error getting portfolio: ${e.message}`;

    console.log(`[BalancePortfolio] ${msg}`);
    return { status: 500, data: msg };
  }

  // log each token balance and value in the format of
  // { symbol: "WMATIC", balance: 0.000000000000000001, value: 0.000000000000000001}
  portfolio.forEach(currentBalance => {
    console.log(
      `[BalancePortfolio] currentBalance: { symbol: "${currentBalance.token.symbol}", balance: ${currentBalance.balance}, value: ${currentBalance.value} }`,
    );
  });

  console.log(`[BalancePortfolio] Total value: ${portfolio.reduce((a, b) => a + b.value, 0)}`);

  // -- Strategy Execution Plan --
  let plan;

  try {
    const res = await getStrategyExecutionPlan(client, authSig, portfolio, strategy);

    plan = res.data;
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
  let spikePercentageDiff = conditions.unless.spikePercentage; // eg. 15 => 15%

  // Unless the percentage difference is greater than 15%, then set the max gas price to 1000 gwei
  // otherwise, set the max gas price to 100 gwei
  let _maxGasPrice =
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
        authSig: authSig,
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

// ------------------------------------------
//          Run Rebalance Function
// ------------------------------------------

const go = async () => {
  // js params example
  // {
  //   tokens: [tokenSwapList.WMATIC, tokenSwapList.USDC],
  //   pkpPublicKey: process.env.PKP_PUBLIC_KEY,
  //   strategy: [
  //     { token: tokenSwapList.USDC.symbol, percentage: 52 },
  //     { token: tokenSwapList.WMATIC.symbol, percentage: 48 },
  //   ],
  //   conditions: {
  //     maxGasPrice: 75,
  //     unit: "gwei",
  //     minExceedPercentage: 1,
  //     unless: {
  //       spikePercentage: 15,
  //       adjustGasPrice: 500,
  //     },
  //   },
  //   rpcUrl: process.env.MATIC_RPC,
  //   dryRun: false,
  // }

  const res = await runBalancePortfolio(jsParams);
  console.log("[Task] res:", res);
};

go();
