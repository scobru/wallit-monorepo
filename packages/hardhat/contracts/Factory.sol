//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;
import "./Wallit.sol";

contract Factory {
  mapping(address => address) public wallits;

  // create a Wallit Instance
  function createWallit() public returns (Wallit) {
    Wallit wallit = new Wallit();
    wallits[msg.sender] = (address(wallit));
    return wallit;
  }

  // get the Wallit instance of the sender
  function getWallit() public view returns (Wallit) {
    if (wallits[msg.sender] == address(0)) {
      return Wallit(address(0));
    } else {
      return Wallit(wallits[msg.sender]);
    }
  }
}
