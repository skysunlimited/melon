pragma solidity ^0.4.4;

import "./dependencies/SafeMath.sol";

/// @title Multisignature wallet - Allows multiple parties to agree on transactions before execution.
/// @author Melonport AG <team@melonport.com>
/// @notice Inspired by Stefan George - <stefan.george@consensys.net>
contract MultiSigWallet is SafeMath {

    event Confirmation(address sender, bytes32 transactionHash);
    event Revocation(address sender, bytes32 transactionHash);
    event Submission(bytes32 transactionHash);
    event Execution(bytes32 transactionHash);
    event Deposit(address sender, uint value);
    event OwnerAddition(address owner);
    event OwnerRemoval(address owner);
    event RequiredUpdate(uint requiredSignatures);

    mapping (bytes32 => Transaction) public transactions;
    mapping (bytes32 => mapping (address => bool)) public confirmations;
    mapping (address => bool) public isOwner;
    address[] owners;
    bytes32[] transactionList;
    uint public requiredSignatures;

    struct Transaction {
        address destination;
        uint value;
        bytes data;
        uint nonce;
        bool executed;
    }

    modifier only_wallet {
        assert(msg.sender == address(this));
        _;
    }

    modifier is_owners_signature(bytes32 transactionHash, uint8[] v, bytes32[] rs) {
        for (uint i = 0; i < v.length; i++)
            assert(isOwner[ecrecover(transactionHash, v[i], rs[i], rs[v.length + i])]);
        _;
    }

    modifier is_owner(address owner) {
        assert(isOwner[owner]);
        _;
    }

    modifier is_not_owner(address owner) {
        assert(!isOwner[owner]);
        _;
    }

    modifier is_confirmed(bytes32 transactionHash, address owner) {
        assert(confirmations[transactionHash][owner]);
        _;
    }

    modifier is_not_confirmed(bytes32 transactionHash, address owner) {
        assert(!confirmations[transactionHash][owner]);
        _;
    }

    modifier is_not_executed(bytes32 transactionHash) {
        assert(!transactions[transactionHash].executed);
        _;
    }

    modifier address_not_null(address destination) {
        //TODO: Test empty input
        assert(destination != 0);
        _;
    }

    modifier valid_amount_of_required_signatures(uint ownerCount, uint required) {
        assert(ownerCount != 0);
        assert(required != 0);
        assert(required <= ownerCount);
        _;
    }

    function addOwner(address owner)
        external
        only_wallet
        is_not_owner(owner)
    {
        isOwner[owner] = true;
        owners.push(owner);
        OwnerAddition(owner);
    }

    function removeOwner(address owner)
        external
        only_wallet
        is_owner(owner)
    {
        isOwner[owner] = false;
        for (uint i = 0; i < owners.length - 1; i++)
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                break;
            }
        owners.length -= 1;
        if (requiredSignatures > owners.length)
            updateRequiredSignatures(owners.length);
        OwnerRemoval(owner);
    }

    function updateRequiredSignatures(uint required)
        public
        only_wallet
        valid_amount_of_required_signatures(owners.length, required)
    {
        requiredSignatures = required;
        RequiredUpdate(requiredSignatures);
    }

    function addTransaction(address destination, uint value, bytes data, uint nonce)
        private
        address_not_null(destination)
        returns (bytes32 transactionHash)
    {
        transactionHash = sha3(destination, value, data, nonce);
        if (transactions[transactionHash].destination == 0) {
            transactions[transactionHash] = Transaction({
                destination: destination,
                value: value,
                data: data,
                nonce: nonce,
                executed: false
            });
            transactionList.push(transactionHash);
            Submission(transactionHash);
        }
    }

    function submitTransaction(address destination, uint value, bytes data, uint nonce)
        external
        returns (bytes32 transactionHash)
    {
        transactionHash = addTransaction(destination, value, data, nonce);
        confirmTransaction(transactionHash);
    }

    function submitTransactionWithSignatures(address destination, uint value, bytes data, uint nonce, uint8[] v, bytes32[] rs)
        external
        returns (bytes32 transactionHash)
    {
        transactionHash = addTransaction(destination, value, data, nonce);
        confirmTransactionWithSignatures(transactionHash, v, rs);
    }

    function addConfirmation(bytes32 transactionHash, address owner)
        private
        is_not_confirmed(transactionHash, owner)
    {
        confirmations[transactionHash][owner] = true;
        Confirmation(owner, transactionHash);
    }

    function confirmTransaction(bytes32 transactionHash)
        public
        is_owner(msg.sender)
    {
        addConfirmation(transactionHash, msg.sender);
        executeTransaction(transactionHash);
    }

    function confirmTransactionWithSignatures(bytes32 transactionHash, uint8[] v, bytes32[] rs)
        public
        is_owners_signature(transactionHash, v, rs)
    {
        for (uint i=0; i<v.length; i++)
            addConfirmation(transactionHash, ecrecover(transactionHash, v[i], rs[i], rs[i + v.length]));
        executeTransaction(transactionHash);
    }

    function executeTransaction(bytes32 transactionHash)
        public
        is_not_executed(transactionHash)
    {
        if (isConfirmed(transactionHash)) {
            Transaction tx = transactions[transactionHash];
            tx.executed = true;
            if (!tx.destination.call.value(tx.value)(tx.data))
                throw;
            Execution(transactionHash);
        }
    }

    function revokeConfirmation(bytes32 transactionHash)
        external
        is_owner(msg.sender)
        is_confirmed(transactionHash, msg.sender)
        is_not_executed(transactionHash)
    {
        confirmations[transactionHash][msg.sender] = false;
        Revocation(msg.sender, transactionHash);
    }

    function MultiSigWallet(address[] _owners, uint required)
        valid_amount_of_required_signatures(_owners.length, required)
    {
        for (uint i=0; i<_owners.length; i++)
            isOwner[_owners[i]] = true;
        owners = _owners;
        requiredSignatures = required;
    }

    function()
        payable
    {
        if (msg.value > 0)
            Deposit(msg.sender, msg.value);
    }

    function isConfirmed(bytes32 transactionHash)
        public
        constant
        returns (bool)
    {
        uint count = 0;
        for (uint i=0; i<owners.length; i++)
            if (confirmations[transactionHash][owners[i]])
                count += 1;
            if (count == requiredSignatures)
                return true;
    }

    function confirmationCount(bytes32 transactionHash)
        external
        constant
        returns (uint count)
    {
        for (uint i=0; i<owners.length; i++)
            if (confirmations[transactionHash][owners[i]])
                count += 1;
    }

    function filterTransactions(bool isPending)
        private
        returns (bytes32[] _transactionList)
    {
        bytes32[] memory _transactionListTemp = new bytes32[](transactionList.length);
        uint count = 0;
        for (uint i=0; i<transactionList.length; i++)
            if (   isPending && !transactions[transactionList[i]].executed
                || !isPending && transactions[transactionList[i]].executed)
            {
                _transactionListTemp[count] = transactionList[i];
                count += 1;
            }
        _transactionList = new bytes32[](count);
        for (i=0; i<count; i++)
            if (_transactionListTemp[i] > 0)
                _transactionList[i] = _transactionListTemp[i];
    }

    function getPendingTransactions()
        external
        constant
        returns (bytes32[] _transactionList)
    {
        return filterTransactions(true);
    }

    function getExecutedTransactions()
        external
        constant
        returns (bytes32[] _transactionList)
    {
        return filterTransactions(false);
    }
}