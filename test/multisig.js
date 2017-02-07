const async = require('async');
const assert = require('assert');
const BigNumber = require('bignumber.js');
const sha256 = require('js-sha256').sha256;

contract('MultiSigWallet', (accounts) => {
  // Test globals
  let multisigContract;

  // Accounts
  const multiSigOwners = accounts.slice(0, 6);
  const requiredSignatures = 3;

  before('Check accounts', (done) => {
    assert.equal(accounts.length, 10);
    done();
  });

  it('Deploy Multisig wallet', (done) => {
    MultiSigWallet.new(multiSigOwners, requiredSignatures).then((result) => {
      multisigContract = result;
      melonport = multisigContract.address;
      return multisigContract.requiredSignatures();
    }).then((result) => {
      assert.equal(result, requiredSignatures);
      web3.eth.sendTransaction(
        { from: accounts[0], to: multisigContract.address, value: web3.toWei(10, 'ether') }, (err) => {
          if (!err) {
            web3.eth.getBalance(multisigContract.address, (err, res) => {
              console.log(res);
              console.log(err);
            });
            done();
          } else {
            done(err);
          }
        });
    });
  });

  it('Test changing Melonport address', (done) => {
    const tx = { destination: accounts[0], value: web3.toWei(5, 'ether'), data: '0', nonce: '0' };
    const sha3Hash = web3.sha3('changeMintingAddress(address)');
    const methodId = `${sha3Hash.slice(2, 10)}${'0'.repeat(32 - 8)}`;
    const data = `0x${methodId}`;
    console.log(methodId);
    let txHash;
    // tx.data = data;
    console.log(tx)
    // txHash = sha3(destination, value, data, nonce);
    // pending hash != this hash!

    multisigContract.submitTransaction(tx.destination, tx.value, tx.data, tx.nonce, { from: multiSigOwners[0] })
    .then(() => multisigContract.getPendingTransactions())
    .then((result) => txHash = result)
    .then(() => multisigContract.confirmTransaction(txHash, { from: multiSigOwners[1] }))
    .then(() => multisigContract.confirmTransaction(txHash, { from: multiSigOwners[2] }))
    .then(() => multisigContract.isConfirmed(txHash))
    .then(() => multisigContract.confirmTransaction(txHash, { from: multiSigOwners[3] }))
    .then(() => multisigContract.isConfirmed(txHash))
    .then((result) => {
      console.log(`Is confirmed: ${result}`);
      return multisigContract.getPendingTransactions();
    })
    .then((result) => {
      console.log(`Pending: ${result}`);
      return multisigContract.getExecutedTransactions();
    })
    .then((result) => {
      console.log(`Executed: ${result}`);
      done();
    });
  });
});