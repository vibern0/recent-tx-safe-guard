// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

library SafeSignatureDecoder {
    error MalformedSafeSignature();
    error ApprovedHashSignature();
    error UnsupportedSignatureType();
    error TrailingSafeSignatureData();
    error NonCanonicalOwnerWord();

    function decode(bytes calldata signatures) internal pure returns (address signer, uint256 ownerEnd) {
        if (signatures.length < 65) revert MalformedSafeSignature();

        uint8 v = uint8(signatures[64]);
        if (v == 1) revert ApprovedHashSignature();
        if (v != 0) revert UnsupportedSignatureType();

        bytes32 ownerWord = bytes32(signatures[0:32]);
        if (uint256(ownerWord) >> 160 != 0) revert NonCanonicalOwnerWord();
        signer = address(uint160(uint256(ownerWord)));
        uint256 offset = uint256(bytes32(signatures[32:64]));
        if (offset != 65 || signatures.length < 65 + 32) revert MalformedSafeSignature();

        uint256 signatureLength = uint256(bytes32(signatures[65:97]));
        ownerEnd = 97 + signatureLength;
        if (ownerEnd > signatures.length) revert MalformedSafeSignature();
    }

    function requireNoTrailingData(bytes calldata signatures, uint256 ownerEnd) internal pure {
        if (signatures.length != ownerEnd) revert TrailingSafeSignatureData();
    }
}
