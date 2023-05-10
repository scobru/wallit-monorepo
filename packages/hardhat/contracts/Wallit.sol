//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/**
 * A smart contract that allows changing a state variable of the contract and tracking the changes
 * It also allows the owner to withdraw the Ether in the contract
 * @author BuidlGuidl
 */
contract Wallit {
  mapping(address => string) public names;
  address public owner;

  constructor(address _owner) {
    owner = _owner;
  }

  function setName(string memory _name, address _addr) public returns (bool) {
    require(msg.sender == owner, "Only the owner can set the name"); //
    names[_addr] = _name;
    return true;
  }

  function getNames(address _addr) public view returns (string memory) {
    return names[_addr];
  }
}
