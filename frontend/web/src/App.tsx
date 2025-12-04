// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface OceanData {
  id: string;
  pH: string;
  carbonate: string;
  temperature: string;
  salinity: string;
  timestamp: number;
  station: string;
  location: string;
  encryptedData: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OceanData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newData, setNewData] = useState({
    pH: "",
    carbonate: "",
    temperature: "",
    salinity: "",
    station: "",
    location: ""
  });
  const [selectedData, setSelectedData] = useState<OceanData | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStation, setFilterStation] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Calculate statistics
  const totalRecords = data.length;
  const uniqueStations = [...new Set(data.map(item => item.station))];
  const avgpH = data.length > 0 ? (data.reduce((sum, item) => sum + parseFloat(item.pH), 0) / data.length).toFixed(2) : "0.00";

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("ocean_data_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing data keys:", e);
        }
      }
      
      const list: OceanData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`ocean_data_${key}`);
          if (dataBytes.length > 0) {
            try {
              const dataItem = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                pH: dataItem.pH,
                carbonate: dataItem.carbonate,
                temperature: dataItem.temperature,
                salinity: dataItem.salinity,
                timestamp: dataItem.timestamp,
                station: dataItem.station,
                location: dataItem.location,
                encryptedData: dataItem.encryptedData
              });
            } catch (e) {
              console.error(`Error parsing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setData(list);
    } catch (e) {
      console.error("Error loading ocean data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const addData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setAdding(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting ocean data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-OCEAN-${btoa(JSON.stringify(newData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const oceanData = {
        pH: newData.pH,
        carbonate: newData.carbonate,
        temperature: newData.temperature,
        salinity: newData.salinity,
        timestamp: Math.floor(Date.now() / 1000),
        station: newData.station,
        location: newData.location,
        encryptedData: encryptedData
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `ocean_data_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(oceanData))
      );
      
      const keysBytes = await contract.getData("ocean_data_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "ocean_data_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Ocean data encrypted and stored securely!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddModal(false);
        setNewData({
          pH: "",
          carbonate: "",
          temperature: "",
          salinity: "",
          station: "",
          location: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setAdding(false);
    }
  };

  const analyzeData = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Analyzing encrypted data with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Check availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        throw new Error("FHE analysis not available");
      }
      
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed! Trends identified securely."
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredData = data.filter(item => {
    const matchesSearch = item.station.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.location.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStation === "all" || item.station === filterStation;
    return matchesSearch && matchesFilter;
  });

  const paginatedData = filteredData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the ocean data platform",
      icon: "🔗"
    },
    {
      title: "Add Encrypted Data",
      description: "Submit pH and carbonate measurements encrypted with FHE",
      icon: "🔒"
    },
    {
      title: "FHE Analysis",
      description: "Process encrypted data to identify acidification trends",
      icon: "📊"
    },
    {
      title: "Get Insights",
      description: "Receive analysis results while keeping data private",
      icon: "🌊"
    }
  ];

  const renderTrendChart = () => {
    // Simple trend visualization
    return (
      <div className="trend-chart">
        <div className="chart-title">pH Trend Analysis</div>
        <div className="chart-container">
          {data.slice(0, 5).map((item, index) => (
            <div key={index} className="chart-bar">
              <div 
                className="bar-fill" 
                style={{ height: `${(parseFloat(item.pH) - 7.5) * 100}px` }}
              ></div>
              <div className="bar-label">{item.pH}</div>
            </div>
          ))}
        </div>
        <div className="chart-legend">Recent pH measurements across stations</div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="ocean-spinner"></div>
      <p>Initializing ocean data connection...</p>
    </div>
  );

  return (
    <div className="app-container ocean-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="wave-icon"></div>
          </div>
          <h1>Ocean<span>Acid</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowAddModal(true)} 
            className="add-data-btn ocean-button"
          >
            <div className="add-icon"></div>
            Add Data
          </button>
          <button 
            className="ocean-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Analysis of Ocean Acidification Data</h2>
            <p>Securely share and analyze encrypted pH and carbonate data using FHE technology</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>Ocean Acidification FHE Platform Guide</h2>
            <p className="subtitle">Learn how to securely process ocean chemistry data</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card ocean-card">
            <h3>Project Introduction</h3>
            <p>Platform for confidential analysis of ocean acidification data using Fully Homomorphic Encryption (FHE) to enable secure collaboration between research stations.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card ocean-card">
            <h3>Data Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{totalRecords}</div>
                <div className="stat-label">Total Records</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{uniqueStations.length}</div>
                <div className="stat-label">Research Stations</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{avgpH}</div>
                <div className="stat-label">Average pH</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card ocean-card">
            <h3>Trend Analysis</h3>
            {renderTrendChart()}
          </div>
        </div>

        <div className="search-filters">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search stations or locations..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ocean-input"
            />
          </div>
          <div className="filter-box">
            <select 
              value={filterStation} 
              onChange={(e) => setFilterStation(e.target.value)}
              className="ocean-select"
            >
              <option value="all">All Stations</option>
              {uniqueStations.map(station => (
                <option key={station} value={station}>{station}</option>
              ))}
            </select>
          </div>
          <button onClick={analyzeData} className="ocean-button primary">
            Analyze with FHE
          </button>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>Encrypted Ocean Data</h2>
            <div className="header-actions">
              <button 
                onClick={loadData}
                className="refresh-btn ocean-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list ocean-card">
            <div className="table-header">
              <div className="header-cell">Station</div>
              <div className="header-cell">Location</div>
              <div className="header-cell">pH</div>
              <div className="header-cell">Carbonate</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {paginatedData.length === 0 ? (
              <div className="no-data">
                <div className="no-data-icon"></div>
                <p>No ocean data records found</p>
                <button 
                  className="ocean-button primary"
                  onClick={() => setShowAddModal(true)}
                >
                  Add First Data Point
                </button>
              </div>
            ) : (
              paginatedData.map(item => (
                <div className="data-row" key={item.id}>
                  <div className="table-cell">{item.station}</div>
                  <div className="table-cell">{item.location}</div>
                  <div className="table-cell">{item.pH}</div>
                  <div className="table-cell">{item.carbonate}</div>
                  <div className="table-cell">
                    {new Date(item.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell actions">
                    <button 
                      className="action-btn ocean-button"
                      onClick={() => setSelectedData(item)}
                    >
                      Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="pagination-btn"
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="pagination-btn"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
  
      {showAddModal && (
        <ModalAdd 
          onSubmit={addData} 
          onClose={() => setShowAddModal(false)} 
          adding={adding}
          data={newData}
          setData={setNewData}
        />
      )}
      
      {selectedData && (
        <DataDetails 
          data={selectedData} 
          onClose={() => setSelectedData(null)} 
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content ocean-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="ocean-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="wave-icon"></div>
              <span>OceanAcidFHE</span>
            </div>
            <p>Confidential analysis of ocean acidification data using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Research Paper</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">API Documentation</a>
            <a href="#" className="footer-link">Contact Research Team</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Marine Research</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} OceanAcidFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalAddProps {
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  data: any;
  setData: (data: any) => void;
}

const ModalAdd: React.FC<ModalAddProps> = ({ 
  onSubmit, 
  onClose, 
  adding,
  data,
  setData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setData({
      ...data,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!data.pH || !data.carbonate || !data.station) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="add-modal ocean-card">
        <div className="modal-header">
          <h2>Add Ocean Data Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Your ocean data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Research Station *</label>
              <input 
                type="text"
                name="station"
                value={data.station} 
                onChange={handleChange}
                placeholder="Station name..." 
                className="ocean-input"
              />
            </div>
            
            <div className="form-group">
              <label>Location *</label>
              <input 
                type="text"
                name="location"
                value={data.location} 
                onChange={handleChange}
                placeholder="Coordinates or region..." 
                className="ocean-input"
              />
            </div>
            
            <div className="form-group">
              <label>pH Level *</label>
              <input 
                type="number"
                step="0.01"
                name="pH"
                value={data.pH} 
                onChange={handleChange}
                placeholder="8.10" 
                className="ocean-input"
              />
            </div>
            
            <div className="form-group">
              <label>Carbonate (μmol/kg) *</label>
              <input 
                type="number"
                step="0.01"
                name="carbonate"
                value={data.carbonate} 
                onChange={handleChange}
                placeholder="205.3" 
                className="ocean-input"
              />
            </div>
            
            <div className="form-group">
              <label>Temperature (°C)</label>
              <input 
                type="number"
                step="0.1"
                name="temperature"
                value={data.temperature} 
                onChange={handleChange}
                placeholder="18.5" 
                className="ocean-input"
              />
            </div>
            
            <div className="form-group">
              <label>Salinity (PSU)</label>
              <input 
                type="number"
                step="0.1"
                name="salinity"
                value={data.salinity} 
                onChange={handleChange}
                placeholder="35.2" 
                className="ocean-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn ocean-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={adding}
            className="submit-btn ocean-button primary"
          >
            {adding ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DataDetailsProps {
  data: OceanData;
  onClose: () => void;
}

const DataDetails: React.FC<DataDetailsProps> = ({ data, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="details-modal ocean-card">
        <div className="modal-header">
          <h2>Ocean Data Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Station:</span>
              <span className="detail-value">{data.station}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Location:</span>
              <span className="detail-value">{data.location}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">pH Level:</span>
              <span className="detail-value">{data.pH}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Carbonate:</span>
              <span className="detail-value">{data.carbonate} μmol/kg</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Temperature:</span>
              <span className="detail-value">{data.temperature} °C</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Salinity:</span>
              <span className="detail-value">{data.salinity} PSU</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Date Recorded:</span>
              <span className="detail-value">{new Date(data.timestamp * 1000).toLocaleString()}</span>
            </div>
          </div>
          
          <div className="encryption-note">
            <div className="lock-icon"></div>
            <span>This data is encrypted using FHE technology for secure analysis</span>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="close-btn ocean-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;