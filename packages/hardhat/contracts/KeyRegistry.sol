// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract KeyRegistry is ERC721, Ownable {
    uint256 private _tokenIdCounter;
    
    struct KeyPair {
        string encryptedPrivateKey;
        string publicKey;
        string name;
    }

    mapping(address => KeyPair[]) private _keys;
    mapping(address => uint256[]) private _ownedTokens;

    constructor() ERC721("KeyRegistry", "KEY") {}

    function registerKey(string memory encryptedPrivateKey, string memory publicKey, string memory name) public {
        KeyPair memory newKeyPair = KeyPair(encryptedPrivateKey, publicKey, name);
        _keys[msg.sender].push(newKeyPair);

        _mint(msg.sender, _tokenIdCounter);
        _ownedTokens[msg.sender].push(_tokenIdCounter);
        _tokenIdCounter++;
    }

    function changeName(uint256 tokenId, string memory newName) public {
        require(_exists(tokenId), "KeyRegistry: Token does not exist");
        require(ownerOf(tokenId) == msg.sender, "KeyRegistry: Only the owner of the token can change its name");
        _keys[msg.sender][tokenId].name = newName;
    }

    function getKeyPair(address owner, uint256 index) public view returns (string memory, string memory) {
        require(_exists(_ownedTokens[owner][index]), "KeyRegistry: No key registered for this address at this index");
        KeyPair memory keyPair = _keys[owner][index];
        return (keyPair.encryptedPrivateKey, keyPair.publicKey);
    }

    function getTokenIds(address owner) public view returns (uint256[] memory) {
        return _ownedTokens[owner];
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        revert("KeyRegistry: Tokens are non-transferrable");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory _data) public override {
        revert("KeyRegistry: Tokens are non-transferrable");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public override {
        revert("KeyRegistry: Tokens are non-transferrable");
    }
}
