//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;
import "./Wallit.sol";

contract Factory {
  mapping(address => address) public wallits;

  // create a Wallit Instance
  function createWallit() public returns (Wallit) {
    Wallit wallit = new Wallit(msg.sender);
    wallits[msg.sender] = (address(wallit));
    return wallit;
  }

  // get the Wallit instance of the sender
  function getWallit(address _addr) public view returns (Wallit) {
    if (wallits[_addr] == address(0)) {
      return Wallit(address(0));
    } else {
      return Wallit(wallits[_addr]);
    }
  }
}
