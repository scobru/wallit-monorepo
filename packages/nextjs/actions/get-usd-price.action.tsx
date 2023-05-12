export const getUsdPriceAction = `const getUSDPrice = async symbol => {
      // this will both set the response to the client and return the data internally
      const respond = data => {
        Lit.Actions.setResponse({
          response: JSON.stringify(data),
        });

        return data;
      };

      const API = "https://min-api.cryptocompare.com/data/price?fsym=" + symbol + "&tsyms=USD";

      let res;
      let data;

      try {
        res = await fetch(API);
        data = await res.json();
      } catch (e) {
        console.log(e);
      }

      if (!res) {
        return respond({ status: 500, data: null });
      }

      return respond({ status: 200, data: data.USD });
    };
    (async () => {
      // --------------------------------------
      //          JS Params Handling
      // --------------------------------------
      const jsParams = {};

      try {
        jsParams.tokenSymbol = tokenSymbol;
      } catch (e) {
        console.error("[ERROR] tokenSymbol is required");
        return;
      }

      // -----------------------
      //          GO!
      // -----------------------
      const res = await getUSDPrice(jsParams.tokenSymbol);

      console.log("res:", res);
    })();
    `;
