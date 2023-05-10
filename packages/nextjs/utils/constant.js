/// Will be added to as more integrations are added.

const polygonAddresses = {
  uniswap: {
    v3: {
      SwapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      SwapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      NonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    },
  },
  oneinch: {
    v5: {
      AggregationRouter: "0x1111111254EEB25477B68fb85Ed929f73A960582",
    },
  },
  wmatic: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
};

export const addresses = {
  polygon: polygonAddresses,
};
