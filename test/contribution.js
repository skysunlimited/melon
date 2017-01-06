var async = require('async');
var assert = require('assert');
var BigNumber = require('bignumber.js');
var sha256 = require('js-sha256').sha256;

function sign(web3, address, value, callback) {
  web3.eth.sign(address, value, (err, sig) => {
    if (!err) {
      try {
        var r = sig.slice(0, 66);
        var s = '0x' + sig.slice(66, 130);
        var v = parseInt('0x' + sig.slice(130, 132), 16);
        if (sig.length<132) {
          //web3.eth.sign shouldn't return a signature of length<132, but if it does...
          sig = sig.slice(2);
          r = '0x' + sig.slice(0, 64);
          s = '0x00' + sig.slice(64, 126);
          v = parseInt('0x' + sig.slice(126, 128), 16);
        }
        if (v!=27 && v!=28) v+=27;
        callback(undefined, {r: r, s: s, v: v});
      } catch (err) {
        callback(err, undefined);
      }
    } else {
      callback(err, undefined);
    }
  });
}

function send(method, params, callback) {
  if (typeof params == "function") {
    callback = params;
    params = [];
  }

  web3.currentProvider.sendAsync({
    jsonrpc: "2.0",
    method: method,
    params: params || [],
    id: new Date().getTime()
  }, callback);
};

contract('Contribution', (accounts) => {

  // Solidity constants
  const hours = 3600;
  const weeks = 24 * 7 * hours;
  const years = 52 * weeks;
  const ether = new BigNumber(Math.pow(10, 18));

  // Contribution constant fields
  const ETHER_CAP = 250000 * ether; // max amount raised during this contribution; targeted amount CHF 2.5MN
  const MAX_CONTRIBUTION_DURATION = 4 * weeks; // max amount in seconds of contribution period
  const BTCS_ETHER_CAP = ETHER_CAP * 25 / 100; // max iced allocation for btcs
  // Price Rates
  const PRICE_RATE_FIRST = 2000; // Four price tiers, each valid for two weeks
  const PRICE_RATE_SECOND = 1950;
  const PRICE_RATE_THIRD = 1900;
  const PRICE_RATE_FOURTH = 1850;
  const DIVISOR_PRICE = 1000; // Price rates are divided by this number
  // Addresses of Patrons
  const FOUNDER_ONE = 0xF1;
  const FOUNDER_TWO = 0xF2;
  const EXT_COMPANY_ONE = 0xC1;
  const EXT_COMPANY_TWO = 0xC2;
  const ADVISOR_ONE = 0xA1;
  const ADVISOR_TWO = 0xA2;
  // Stakes of Patrons
  const DIVISOR_STAKE = 10000; // stakes are divided by this number; results to one basis point
  const MELONPORT_COMPANY_STAKE = 1000; // 12% of all created melon token allocated to melonport company
  const EXT_COMPANY_STAKE_ONE = 300; // 3% of all created melon token allocated to external company
  const EXT_COMPANY_STAKE_TWO = 100; // 1% of all created melon token allocated to external company
  const FOUNDER_STAKE = 450; // 4.5% of all created melon token allocated to founder
  const ADVISOR_STAKE_ONE = 50; // 0.5% of all created melon token allocated to advisor
  const ADVISOR_STAKE_TWO = 25; // 0.25% of all created melon token allocated to advisor

  // Melon Token constant fields
  const decimals = 18;
  const THAWING_DURATION = 2 * years; // time needed for iced tokens to thaw into liquid tokens
  const MAX_TOTAL_TOKEN_AMOUNT = 1250000 * (new BigNumber(Math.pow(10, decimals))); // max amount of total tokens raised during all contributions

  const MAX_TOTAL_MLN_AMOUNT = 1250000
  const mln = new BigNumber(Math.pow(10, decimals))

  // Test globals
  let multisigContract;
  let contributionContract;
  let melonContract;
  let testCases;

  // Accounts
  const multiSigOwners = accounts.slice(0, 6);
  const requiredSignatures = 4;
  let melonport; // defined as multisigContract.address
  const btcs = accounts[1];
  const signer = accounts[2];

  var initalBlockTime;
  const startDelay = 1 * weeks;
  var startTime;
  var endTime;
  const numTestCases = 8;

  var snapshotIds = [];
  var timeTravelTwoYearForward = 2 * years;


  describe('PREPARATIONS', () => {
    before('Check accounts', (done) => {
      assert.equal(accounts.length, 10);
      done();
    });

    beforeEach("Checkpoint, so that we can revert later", (done) => {
      send("evm_snapshot", (err, result) => {
        if (!err) {
          snapshotIds.push(result.id);
        }
        done(err);
      });
    });

    it('Set startTime as now', (done) => {
      web3.eth.getBlock('latest', function(err, result) {
        initalBlockTime = result.timestamp;
        startTime = initalBlockTime + startDelay;
        endTime = startTime + 4*weeks;

        done();
      });
    });

    it('Set up test cases', (done) => {
      testCases = [];
      for (i = 0; i < numTestCases; i++) {
        const timeSpacing = (endTime - startTime) / numTestCases;
        const blockTime = Math.round(startTime + i * timeSpacing);
        let expectedPrice;
        if (blockTime>=startTime && blockTime<startTime + 1*weeks) {
          expectedPrice = 2000;
        } else if (blockTime>=startTime + 1*weeks && blockTime < startTime + 2*weeks) {
          expectedPrice = 1950;
        } else if (blockTime>=startTime + 2*weeks && blockTime < startTime + 3*weeks) {
          expectedPrice = 1900;
        } else if (blockTime>=startTime + 3*weeks && blockTime < endTime) {
          expectedPrice = 1850;
        } else {
          expectedPrice = 0;
        }
        const accountNum = Math.max(1, Math.min(i + 1, accounts.length-1));
        const account = accounts[accountNum];
        expectedPrice = Math.round(expectedPrice);
        testCases.push(
          {
            accountNum: accountNum,
            blockTime: blockTime,
            timeSpacing: timeSpacing,
            expectedPrice: expectedPrice,
            account: account,
          }
        );
      }
      done();
    });

    it('Sign test cases', (done) => {
      async.mapSeries(testCases,
        function(testCase, callbackMap) {
          const hash = '0x' + sha256(new Buffer(testCase.account.slice(2),'hex'));
          sign(web3, signer, hash, (err, sig) => {
            testCase.v = sig.v;
            testCase.r = sig.r;
            testCase.s = sig.s;
            callbackMap(null, testCase);
          });
        },
        function(err, newTestCases) {
          testCases = newTestCases;
          done();
        }
      );
    });
  });

  describe('CONTRACT DEPLOYMENT', () => {
    it('Deploy Multisig wallet', (done) => {
      MultiSigWallet.new(multiSigOwners, requiredSignatures).then((result) => {
        multisigContract = result;
        melonport = multisigContract.address;
        return multisigContract.requiredSignatures();
      }).then((result) => {
        assert.equal(result, requiredSignatures);
        done();
      });
    });

    it('Deploy Contribution contracts', (done) => {
      Contribution.new(melonport, btcs, signer, startTime).then((result) => {
        contributionContract = result;
        return contributionContract.melonToken();
      }).then((result) => {
        melonContract = MelonToken.at(result);
        done();
      });
    });

    it('Check Melon Token initialisation', (done) => {
      melonContract.MAX_TOTAL_TOKEN_AMOUNT().then((result) => {
        assert.equal(result, MAX_TOTAL_TOKEN_AMOUNT);
        return melonContract.minter();
      }).then((result) => {
        assert.equal(result, contributionContract.address);
        return melonContract.melonport();
      }).then((result) => {
        assert.equal(result, melonport);
        return melonContract.startTime();
      }).then((result) => {
        assert.equal(result, startTime);
        return melonContract.endTime();
      }).then((result) => {
        assert.equal(result, endTime)
        done();
      });
    });

    it('Check premined allocation', (done) => {
      melonContract.balanceOf(melonport).then((result) => {
        assert.equal(
          result.toNumber(),
          MELONPORT_COMPANY_STAKE * MAX_TOTAL_MLN_AMOUNT / DIVISOR_STAKE * mln
        );
        return melonContract.lockedBalanceOf(FOUNDER_ONE);
      }).then((result) => {
        assert.equal(
          result.toNumber(),
          FOUNDER_STAKE * MAX_TOTAL_MLN_AMOUNT / DIVISOR_STAKE * mln
        );
        return melonContract.lockedBalanceOf(FOUNDER_TWO);
      }).then((result) => {
        assert.equal(
          result.toNumber(),
          FOUNDER_STAKE * MAX_TOTAL_MLN_AMOUNT / DIVISOR_STAKE * mln
        );
        return melonContract.lockedBalanceOf(EXT_COMPANY_ONE);
      }).then((result) => {
        assert.equal(
          result.toNumber(),
          EXT_COMPANY_STAKE_ONE * MAX_TOTAL_MLN_AMOUNT / DIVISOR_STAKE * mln
        );
        return melonContract.lockedBalanceOf(EXT_COMPANY_TWO);
      }).then((result) => {
        assert.equal(
          result.toNumber(),
          EXT_COMPANY_STAKE_TWO * MAX_TOTAL_MLN_AMOUNT / DIVISOR_STAKE * mln
        );
        return melonContract.lockedBalanceOf(ADVISOR_ONE);
      }).then((result) => {
        assert.equal(
          result.toNumber(),
          ADVISOR_STAKE_ONE * MAX_TOTAL_MLN_AMOUNT / DIVISOR_STAKE * mln
        );
        return melonContract.lockedBalanceOf(ADVISOR_TWO);
      }).then((result) => {
        assert.equal(
          result.toNumber(),
          ADVISOR_STAKE_TWO * MAX_TOTAL_MLN_AMOUNT / DIVISOR_STAKE * mln
        );
        done();
      })
    });
  });

  describe('CONTRIBUTION', () => {
    it('Test BTCS access', (done) => {

      const testCase = {
        buyer: btcs,
        buy_for_how_much_ether: web3.toWei(2.1, "ether"),
        recipient_of_melon: accounts[9],
        expected_price: PRICE_RATE_FIRST / DIVISOR_PRICE,
        expected_melon_amount: web3.toWei(2.1, "ether") * PRICE_RATE_FIRST / DIVISOR_PRICE,
      }

      web3.eth.getBalance(melonport, (err, result) => {
        const initialBalance = result;

        contributionContract.btcsBuyRecipient(
          testCase.recipient_of_melon,
          { from: testCase.buyer, value: testCase.buy_for_how_much_ether }).then(() => {
          return melonContract.balanceOf(testCase.recipient_of_melon);
        }).then((result) => {
          assert.equal(
            result.toNumber(),
            testCase.expected_melon_amount);
          // After contribution period already started
          //TODO fix spacing
          send("evm_increaseTime", [startDelay], (err, result) => {
            assert.equal(err, null);
            contributionContract.btcsBuyRecipient(
              testCase.recipient_of_melon,
              { from: testCase.buyer, value: testCase.buy_for_how_much_ether })
            .then(() => {
              assert.fail();
            }).catch((err) => {
              console.log(`Err.name: ${err.name}`)
              assert.notEqual(err.name, 'AssertionError');
              web3.eth.getBalance(melonport, (err, result) => {
                var finalBalance = result;
                assert.equal(
                  finalBalance.minus(initialBalance),
                  testCase.buy_for_how_much_ether
                );
                done();
              });
            });
          });
        });
      });
    });

    it('Test buy', (done) => {
      //TODO in object
      var amountToBuy = web3.toWei(2.1, "ether");
      var amountBought = new BigNumber(0);

      web3.eth.getBalance(melonport, function(err, result){
        var initialBalance = result;
        async.eachSeries(testCases,
          function(testCase, callbackEach) {

            //TODO fix spacing
            send("evm_increaseTime", [testCase.timeSpacing - 60], (err, result) => {
              assert.equal(err, null);

              contributionContract.buy(
                testCase.v, testCase.r, testCase.s,
                {from: testCase.account, value: amountToBuy })
              .then(() => {
                amountBought = amountBought.add(amountToBuy);
                return melonContract.balanceOf(testCase.account);
              }).then((result) => {
                console.log(`Expected Price: ${testCase.expectedPrice}`);
                assert.equal(
                  result.toNumber(),
                  testCase.expectedPrice / DIVISOR_PRICE * amountToBuy
                );
                callbackEach();
              });
            });
          },
          function(err) {
            web3.eth.getBalance(melonport, function(err, result){
              var finalBalance = result;
              assert.equal(
                finalBalance.minus(initialBalance).toNumber(),
                amountBought.toNumber()
              );
              done();
            });
          }
        );
      });
    });

    it('Test buying on behalf of a recipient', (done) => {
      done();
    });

    it('Test changing Melonport address', (done) => {
      done();
    });
  });

  describe('SETTING OF NEW MINTER', () => {

  });
});
