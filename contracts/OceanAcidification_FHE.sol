// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract OceanAcidification_FHE is SepoliaConfig {
    struct EncryptedData {
        uint256 stationId;
        euint32 encryptedPH;          // Encrypted pH value
        euint32 encryptedCarbonate;   // Encrypted carbonate level
        euint32 encryptedTemperature; // Encrypted temperature
        uint256 timestamp;
    }
    
    struct DecryptedData {
        float phValue;
        float carbonateLevel;
        float temperature;
        bool isRevealed;
    }

    uint256 public dataCount;
    mapping(uint256 => EncryptedData) public encryptedMeasurements;
    mapping(uint256 => DecryptedData) public decryptedMeasurements;
    
    mapping(string => euint32) private encryptedRegionStats;
    string[] private regionList;
    
    mapping(uint256 => uint256) private requestToMeasurementId;
    
    event MeasurementSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event MeasurementDecrypted(uint256 indexed id);
    
    modifier onlyStationOwner(uint256 measurementId) {
        _;
    }
    
    function submitEncryptedMeasurement(
        euint32 encryptedPH,
        euint32 encryptedCarbonate,
        euint32 encryptedTemperature,
        string memory region
    ) public {
        dataCount += 1;
        uint256 newId = dataCount;
        
        encryptedMeasurements[newId] = EncryptedData({
            stationId: newId,
            encryptedPH: encryptedPH,
            encryptedCarbonate: encryptedCarbonate,
            encryptedTemperature: encryptedTemperature,
            timestamp: block.timestamp
        });
        
        decryptedMeasurements[newId] = DecryptedData({
            phValue: 0,
            carbonateLevel: 0,
            temperature: 0,
            isRevealed: false
        });
        
        if (!FHE.isInitialized(encryptedRegionStats[region])) {
            encryptedRegionStats[region] = FHE.asEuint32(0);
            regionList.push(region);
        }
        
        emit MeasurementSubmitted(newId, block.timestamp);
    }
    
    function requestMeasurementDecryption(uint256 measurementId) public onlyStationOwner(measurementId) {
        EncryptedData storage data = encryptedMeasurements[measureId];
        require(!decryptedMeasurements[measurementId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(data.encryptedPH);
        ciphertexts[1] = FHE.toBytes32(data.encryptedCarbonate);
        ciphertexts[2] = FHE.toBytes32(data.encryptedTemperature);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptMeasurement.selector);
        requestToMeasurementId[reqId] = measurementId;
        
        emit DecryptionRequested(measurementId);
    }
    
    function decryptMeasurement(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 measurementId = requestToMeasurementId[requestId];
        require(measurementId != 0, "Invalid request");
        
        EncryptedData storage eData = encryptedMeasurements[measurementId];
        DecryptedData storage dData = decryptedMeasurements[measurementId];
        require(!dData.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        float[] memory results = abi.decode(cleartexts, (float[]));
        
        dData.phValue = results[0];
        dData.carbonateLevel = results[1];
        dData.temperature = results[2];
        dData.isRevealed = true;
        
        emit MeasurementDecrypted(measurementId);
    }
    
    function getDecryptedMeasurement(uint256 measurementId) public view returns (
        float phValue,
        float carbonateLevel,
        float temperature,
        bool isRevealed
    ) {
        DecryptedData storage d = decryptedMeasurements[measurementId];
        return (d.phValue, d.carbonateLevel, d.temperature, d.isRevealed);
    }
    
    function getEncryptedRegionStats(string memory region) public view returns (euint32) {
        return encryptedRegionStats[region];
    }
    
    function requestRegionStatsDecryption(string memory region) public {
        euint32 stats = encryptedRegionStats[region];
        require(FHE.isInitialized(stats), "Region not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptRegionStats.selector);
        requestToMeasurementId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(region)));
    }
    
    function decryptRegionStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 regionHash = requestToMeasurementId[requestId];
        string memory region = getRegionFromHash(regionHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getRegionFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < regionList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(regionList[i]))) == hash) {
                return regionList[i];
            }
        }
        revert("Region not found");
    }
    
    function calculateAcidificationTrend(euint32[] memory phValues) public pure returns (euint32) {
        require(phValues.length > 1, "Insufficient data");
        
        euint32 sum = FHE.asEuint32(0);
        for (uint i = 0; i < phValues.length; i++) {
            sum = FHE.add(sum, phValues[i]);
        }
        
        euint32 average = FHE.div(sum, FHE.asEuint32(uint32(phValues.length)));
        return average;
    }
}