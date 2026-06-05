'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  FileUp, 
  Key, 
  Layers, 
  ArrowRight, 
  CheckCircle2, 
  AlertTriangle, 
  Download, 
  Trash2, 
  Sparkles, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Settings, 
  RotateCcw,
  FolderOpen
} from 'lucide-react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function GLRPipelinePage() {
  // Navigation Steps: 1 = Upload, 2 = Processing, 3 = Review & Edit, 4 = Download
  const [step, setStep] = useState<number>(1);
  
  // Settings Accordion Open/Closed state
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  
  // Active review tab
  const [activeTab, setActiveTab] = useState<string>('loss');
  
  // Provider Selection: 'gemini' | 'groq' | 'openrouter'
  const [provider, setProvider] = useState<string>('gemini');
  
  // Server-side API key configuration states
  const [serverConfig, setServerConfig] = useState({
    geminiKeySet: false,
    groqKeySet: false,
    openrouterKeySet: false
  });
  
  // Files State
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  
  // User API Keys (stored in state & optionally localStorage)
  const [apiKeyGemini, setApiKeyGemini] = useState<string>('');
  const [apiKeyGroq, setApiKeyGroq] = useState<string>('');
  const [apiKeyOpenrouter, setApiKeyOpenrouter] = useState<string>('');
  
  const [model, setModel] = useState<string>('gemini-3.5-flash');
  
  // Dynamic Extraction States
  const [placeholders, setPlaceholders] = useState<string[]>([]);
  const [extractedText, setExtractedText] = useState<string>('');
  const [extractedData, setExtractedData] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  // Server Status
  const [backendHealthy, setBackendHealthy] = useState<boolean>(true);
  
  // Loader status
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [subStatusMessage, setSubStatusMessage] = useState<string>('');
  
  // Final download states
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  
  // Refs for hidden inputs
  const templateInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // Fetch backend configurations and health on mount
  useEffect(() => {
    // 1. Health check
    fetch(`${API_BASE_URL}/api/health`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok') setBackendHealthy(true);
      })
      .catch(() => {
        setBackendHealthy(false);
      });
      
    // 2. Fetch server API key pre-configurations
    fetch(`${API_BASE_URL}/api/config`)
      .then(res => res.json())
      .then(data => {
        setServerConfig(data);
      })
      .catch(err => {
        console.error('Error fetching server config:', err);
      });
      
    // 3. Load user-saved local keys
    if (typeof window !== 'undefined') {
      setApiKeyGemini(localStorage.getItem('glr_key_gemini') || '');
      setApiKeyGroq(localStorage.getItem('glr_key_groq') || '');
      setApiKeyOpenrouter(localStorage.getItem('glr_key_openrouter') || '');
      
      const savedProvider = localStorage.getItem('glr_provider');
      if (savedProvider) setProvider(savedProvider);
    }
  }, []);

  const handleProviderChange = (val: string) => {
    setProvider(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('glr_provider', val);
    }
    
    // Auto-update default models depending on selection
    if (val === 'gemini') setModel('gemini-3.5-flash');
    else if (val === 'groq') setModel('llama-3.1-8b-instant');
    else setModel('openai/gpt-3.5-turbo');
  };

  const handleKeyChange = (providerName: string, val: string) => {
    if (providerName === 'gemini') {
      setApiKeyGemini(val);
      localStorage.setItem('glr_key_gemini', val);
    } else if (providerName === 'groq') {
      setApiKeyGroq(val);
      localStorage.setItem('glr_key_groq', val);
    } else {
      setApiKeyOpenrouter(val);
      localStorage.setItem('glr_key_openrouter', val);
    }
  };

  // Get active user API key for selected provider
  const getActiveUserKey = () => {
    if (provider === 'gemini') return apiKeyGemini;
    if (provider === 'groq') return apiKeyGroq;
    return apiKeyOpenrouter;
  };

  // Check if active provider has an API key set either in user state OR server env
  const isKeyConfigured = () => {
    const userKey = getActiveUserKey().trim();
    if (userKey) return true;
    
    if (provider === 'gemini') return serverConfig.geminiKeySet;
    if (provider === 'groq') return serverConfig.groqKeySet;
    return serverConfig.openrouterKeySet;
  };

  // Upload handlers
  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setTemplateFile(e.target.files[0]);
      setErrorMsg('');
    }
  };

  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setPdfFiles(prev => [...prev, ...newFiles]);
      setErrorMsg('');
    }
  };

  const removePdfFile = (index: number) => {
    setPdfFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Main Pipeline Processing Action
  const runPipelineAnalysis = async () => {
    if (!templateFile) {
      setErrorMsg('Please upload an insurance template Word document (.docx).');
      return;
    }
    if (pdfFiles.length === 0) {
      setErrorMsg('Please upload at least one PDF photo report.');
      return;
    }
    
    // Check key config
    if (!isKeyConfigured()) {
      setErrorMsg(`API Key missing. Please provide a key for the selected provider (${provider.toUpperCase()}) or configure it in the backend .env file.`);
      setSettingsOpen(true);
      return;
    }

    setStep(2); // Go to Processing Step
    setErrorMsg('');
    
    let currentPlaceholders: string[] = [];
    let currentText = '';
    
    try {
      // 1. Upload Template & Parse Placeholders
      setStatusMessage('Scanning Word Template...');
      setSubStatusMessage('Extracting document placeholders and fields structures...');
      
      const tFormData = new FormData();
      tFormData.append('template', templateFile);
      
      const tRes = await fetch(`${API_BASE_URL}/api/extract-placeholders`, {
        method: 'POST',
        body: tFormData
      });
      
      if (!tRes.ok) {
        const err = await tRes.json();
        throw new Error(err.detail || 'Failed to extract placeholders from template.');
      }
      
      const tData = await tRes.json();
      currentPlaceholders = tData.placeholders;
      setPlaceholders(currentPlaceholders);
      
      if (currentPlaceholders.length === 0) {
        throw new Error('No placeholders (like [FIELD] or {{FIELD}}) found in the uploaded Word template.');
      }
      
      // 2. Upload PDFs & Extract Text
      setStatusMessage('Reading PDF Photo Reports...');
      setSubStatusMessage('Parsing text contents and running page OCR fallback filters...');
      
      const pFormData = new FormData();
      pdfFiles.forEach(file => {
        pFormData.append('files', file);
      });
      
      const pRes = await fetch(`${API_BASE_URL}/api/extract-pdf-text`, {
        method: 'POST',
        body: pFormData
      });
      
      if (!pRes.ok) {
        const err = await pRes.json();
        throw new Error(err.detail || 'Failed to extract text from PDF reports.');
      }
      
      const pData = await pRes.json();
      currentText = pData.text;
      setExtractedText(currentText);
      if (pData.warnings) setWarnings(pData.warnings);
      
      // 3. Query LLM for key extraction
      setStatusMessage('AI Cross-Referencing...');
      setSubStatusMessage(`Extracting claim values using ${provider.toUpperCase()} (${model})...`);
      
      const activeKey = getActiveUserKey().trim();
      const finalKey = activeKey === "" ? "default" : activeKey;
      
      const lFormData = new FormData();
      lFormData.append('text', currentText);
      lFormData.append('api_key', finalKey);
      lFormData.append('required_fields', JSON.stringify(currentPlaceholders));
      lFormData.append('provider', provider);
      lFormData.append('model', model);
      
      const lRes = await fetch(`${API_BASE_URL}/api/extract-data`, {
        method: 'POST',
        body: lFormData
      });
      
      if (!lRes.ok) {
        const err = await lRes.json();
        throw new Error(err.detail || 'Failed to communicate with LLM parser API.');
      }
      
      const lData = await lRes.json();
      if (!lData.success) {
        throw new Error(lData.error || 'LLM parsing failed to output JSON.');
      }
      
      setExtractedData(lData.data);
      
      // Categorize default active tab
      const lossKeys = currentPlaceholders.filter(k => categorizePlaceholder(k) === 'loss');
      if (lossKeys.length > 0) {
        setActiveTab('loss');
      } else {
        const propKeys = currentPlaceholders.filter(k => categorizePlaceholder(k) === 'property');
        if (propKeys.length > 0) setActiveTab('property');
        else setActiveTab('vendor');
      }
      
      setStep(3); // Transition to Edit Form
      
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'An unexpected error occurred during analysis.');
      setStep(1); // Go back to start
    }
  };

  // Compile Final Document Route
  const compileFinalReport = async () => {
    if (!templateFile) return;
    
    setStep(2); // Show processing screen
    setStatusMessage('Compiling Document Template...');
    setSubStatusMessage('Merging text runs and exporting your formatted Word file...');
    
    try {
      const fFormData = new FormData();
      fFormData.append('template', templateFile);
      fFormData.append('data', JSON.stringify(extractedData));
      
      const res = await fetch(`${API_BASE_URL}/api/fill-template`, {
        method: 'POST',
        body: fFormData
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to compile template.');
      }
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      setDownloadUrl(url);
      setStep(4); // Download Step
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'Error occurred while compiling template.');
      setStep(3); // Back to editor
    }
  };

  const startNewReport = () => {
    if (downloadUrl) {
      window.URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    setTemplateFile(null);
    setPdfFiles([]);
    setPlaceholders([]);
    setExtractedText('');
    setExtractedData({});
    setWarnings([]);
    setErrorMsg('');
    setStep(1);
  };

  // Dynamic grouping logic for placeholders
  const categorizePlaceholder = (key: string): string => {
    const k = key.toUpperCase();
    if (k.includes('INSURED') || k.includes('NAME') || k.includes('STREET') || k.includes('CITY') || k.includes('STATE') || k.includes('ZIP') || k.includes('COV')) {
      return 'property';
    }
    if (k.includes('DATE') || k.includes('LOSS') || k.includes('TOL') || k.includes('CLAIM') || k.includes('POLICY') || k.includes('FILE')) {
      return 'loss';
    }
    return 'vendor';
  };

  const categories = [
    { id: 'loss', label: 'Loss & Claims', keys: placeholders.filter(k => categorizePlaceholder(k) === 'loss') },
    { id: 'property', label: 'Insured & Property', keys: placeholders.filter(k => categorizePlaceholder(k) === 'property') },
    { id: 'vendor', label: 'Mortgage & Vendor', keys: placeholders.filter(k => categorizePlaceholder(k) === 'vendor') }
  ].filter(cat => cat.keys.length > 0);

  // Stepper active line width calculations
  const getStepperWidth = () => {
    if (step === 1) return '0%';
    if (step === 2) return '33%';
    if (step === 3) return '66%';
    return '100%';
  };

  // Helper text dynamically returned for API Key label
  const getApiKeyLabel = () => {
    if (provider === 'gemini') {
      return serverConfig.geminiKeySet ? 'Google Gemini API Key (Using Server Key - Optional)' : 'Google Gemini API Key (Required)';
    }
    if (provider === 'groq') {
      return serverConfig.groqKeySet ? 'Groq API Key (Using Server Key - Optional)' : 'Groq API Key (Required)';
    }
    return serverConfig.openrouterKeySet ? 'OpenRouter API Key (Using Server Key - Optional)' : 'OpenRouter API Key (Required)';
  };

  return (
    <main className="saas-layout">
      {/* Dynamic Health Check Status Badge */}
      <div className="health-badge">
        <span className={`health-dot ${backendHealthy ? '' : 'offline'}`}></span>
        {backendHealthy ? 'FastAPI Online' : 'FastAPI Offline'}
      </div>

      {/* Main SaaS Branding Header */}
      <header className="app-header">
        <span className="app-logo">💼</span>
        <h2 className="app-title">GLR Claims Portal</h2>
        <p className="app-subtitle">Populate claims templates automatically using layout extraction & AI</p>
      </header>

      {/* Premium Stepper Progress Indicator */}
      <div className="stepper-container">
        <div className="stepper-line"></div>
        <div className="stepper-line-active" style={{ width: getStepperWidth() }}></div>
        
        <div className={`step-node ${step === 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
          <div className="step-circle">{step > 1 ? <Check size={16} /> : '1'}</div>
          <span className="step-label">Upload Files</span>
        </div>
        <div className={`step-node ${step === 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
          <div className="step-circle">{step > 2 ? <Check size={16} /> : '2'}</div>
          <span className="step-label">Analyzing</span>
        </div>
        <div className={`step-node ${step === 3 ? 'active' : ''} ${step > 3 ? 'completed' : ''}`}>
          <div className="step-circle">{step > 3 ? <Check size={16} /> : '3'}</div>
          <span className="step-label">Verify Data</span>
        </div>
        <div className={`step-node ${step === 4 ? 'active' : ''}`}>
          <div className="step-circle">4</div>
          <span className="step-label">Download</span>
        </div>
      </div>

      {/* Global Error Banner */}
      {errorMsg && (
        <div className="alert-banner">
          <AlertTriangle size={18} />
          <div>
            <strong>Error:</strong> {errorMsg}
          </div>
        </div>
      )}

      {/* OCR Warnings list inside Review View */}
      {step === 3 && warnings.length > 0 && (
        <div className="alert-banner warning">
          <AlertTriangle size={18} />
          <div>
            <strong>OCR Warnings:</strong>
            <ul style={{ paddingLeft: '18px', marginTop: '4px', fontSize: '12.5px', lineHeight: 1.5 }}>
              {warnings.map((w, idx) => <li key={idx}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* ----------------- STEP 1: UPLOAD WORKFLOW ----------------- */}
      {step === 1 && (
        <div>
          <div className="upload-grid">
            {/* Word Template Dropzone Card */}
            <div className="upload-card">
              <div className="upload-card-title">
                <FileText size={18} style={{ color: 'var(--primary-accent)' }} />
                <span>Adjuster Template (.docx)</span>
              </div>
              
              <input 
                type="file" 
                accept=".docx" 
                ref={templateInputRef} 
                onChange={handleTemplateUpload}
                style={{ display: 'none' }}
              />
              
              <div 
                className="dropzone-container" 
                onClick={() => templateInputRef.current?.click()}
              >
                <FolderOpen className="dropzone-icon" size={32} />
                <div className="dropzone-text">
                  {templateFile ? (
                    <span>Loaded: <strong style={{ color: 'var(--text-main)' }}>{templateFile.name}</strong></span>
                  ) : (
                    <span>Drag & drop Word file here, or <span className="dropzone-highlight">browse</span></span>
                  )}
                </div>
              </div>
            </div>

            {/* PDF Reports Dropzone Card */}
            <div className="upload-card">
              <div className="upload-card-title">
                <FileUp size={18} style={{ color: 'var(--primary-accent)' }} />
                <span>Loss Reports (.pdf)</span>
              </div>
              
              <input 
                type="file" 
                accept=".pdf" 
                multiple 
                ref={pdfInputRef} 
                onChange={handlePdfUpload}
                style={{ display: 'none' }}
              />
              
              <div 
                className="dropzone-container" 
                onClick={() => pdfInputRef.current?.click()}
              >
                <Layers className="dropzone-icon" size={32} />
                <div className="dropzone-text">
                  Drag & drop PDF photo files, or <span className="dropzone-highlight">browse</span>
                </div>
              </div>

              {pdfFiles.length > 0 && (
                <div className="uploaded-files-list">
                  {pdfFiles.map((file, idx) => (
                    <div className="file-item" key={idx}>
                      <div className="file-name-container">
                        <Layers size={14} style={{ color: 'var(--primary-accent)', flexShrink: 0 }} />
                        <span>{file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
                      </div>
                      <button className="btn-delete-file" onClick={() => removePdfFile(idx)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Settings collapsible Accordion drawer */}
          <div className="settings-drawer">
            <div className="settings-drawer-header" onClick={() => setSettingsOpen(!settingsOpen)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={16} /> API Key & Model Configuration
              </span>
              {settingsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
            
            {settingsOpen && (
              <div className="settings-drawer-body">
                <div>
                  <label className="form-label">AI Engine Provider</label>
                  <div className="provider-toggle-group">
                    <button 
                      className={`provider-btn ${provider === 'gemini' ? 'active' : ''}`}
                      onClick={() => handleProviderChange('gemini')}
                    >
                      Gemini (Free)
                    </button>
                    <button 
                      className={`provider-btn ${provider === 'groq' ? 'active' : ''}`}
                      onClick={() => handleProviderChange('groq')}
                    >
                      Groq (Free)
                    </button>
                    <button 
                      className={`provider-btn ${provider === 'openrouter' ? 'active' : ''}`}
                      onClick={() => handleProviderChange('openrouter')}
                    >
                      OpenRouter
                    </button>
                  </div>
                  
                  <div className="form-group">
                    <label className="form-label">{getApiKeyLabel()}</label>
                    {provider === 'gemini' && (
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder={serverConfig.geminiKeySet ? "Using pre-configured server key" : "Enter your Gemini API key (starts with AIza)"}
                        value={apiKeyGemini}
                        onChange={(e) => handleKeyChange('gemini', e.target.value)}
                      />
                    )}
                    {provider === 'groq' && (
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder={serverConfig.groqKeySet ? "Using pre-configured server key" : "Enter your Groq API key (starts with gsk)"}
                        value={apiKeyGroq}
                        onChange={(e) => handleKeyChange('groq', e.target.value)}
                      />
                    )}
                    {provider === 'openrouter' && (
                      <input 
                        type="password" 
                        className="form-input" 
                        placeholder={serverConfig.openrouterKeySet ? "Using pre-configured server key" : "Enter your OpenRouter API key (starts with sk-or)"}
                        value={apiKeyOpenrouter}
                        onChange={(e) => handleKeyChange('openrouter', e.target.value)}
                      />
                    )}
                  </div>
                </div>

                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  <label className="form-label">Extraction LLM Model</label>
                  <select 
                    className="form-select" 
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {provider === 'gemini' && (
                      <>
                        <option value="gemini-3.5-flash">Gemini 3.5 Flash (Fast Free)</option>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                      </>
                    )}
                    {provider === 'groq' && (
                      <>
                        <option value="llama-3.1-8b-instant">Llama 3.1 8B Instant (Free)</option>
                        <option value="llama3-8b-8192">Llama 3 8B 8192 (Free)</option>
                      </>
                    )}
                    {provider === 'openrouter' && (
                      <>
                        <option value="openai/gpt-3.5-turbo">OpenAI GPT-3.5 Turbo</option>
                        <option value="deepseek/deepseek-chat">DeepSeek Chat v3</option>
                        <option value="google/gemini-flash-1.5">Google Gemini 1.5 Flash</option>
                        <option value="anthropic/claude-3.5-sonnet">Anthropic Claude 3.5 Sonnet</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Analyze launcher Button */}
          <button 
            className="btn-primary" 
            style={{ width: '100%', padding: '16px' }}
            onClick={runPipelineAnalysis}
            disabled={!backendHealthy}
          >
            Analyze Files & Parse <ArrowRight size={18} />
          </button>
        </div>
      )}

      {/* ----------------- STEP 2: RADAR RADIAL SCANNING ----------------- */}
      {step === 2 && (
        <div className="radar-container">
          <div className="radar-scanner"></div>
          <div style={{ textAlign: 'center' }}>
            <div className="loader-status">{statusMessage}</div>
            <div className="loader-substatus" style={{ marginTop: '4px' }}>{subStatusMessage}</div>
          </div>
        </div>
      )}

      {/* ----------------- STEP 3: TABBED REVIEW GRID ----------------- */}
      {step === 3 && (
        <div>
          {/* Dynamic Tabs Navigation Bar */}
          {categories.length > 1 && (
            <div className="tab-row">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  className={`tab-btn ${activeTab === cat.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(cat.id)}
                >
                  {cat.label} ({cat.keys.length})
                </button>
              ))}
            </div>
          )}

          {/* Grid inputs wrapper */}
          <div className="review-grid">
            {placeholders
              .filter(key => categories.length <= 1 || categorizePlaceholder(key) === activeTab)
              .map(key => (
                <div className="review-field" key={key}>
                  <label className="review-label">{key.replace('XM8_', '').replace(/_/g, ' ')}</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={extractedData[key] || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setExtractedData(prev => ({ ...prev, [key]: val }));
                    }}
                  />
                </div>
              ))
            }
          </div>

          {/* Footer action buttons */}
          <div className="btn-group">
            <button className="btn-secondary" onClick={() => setStep(1)}>
              <RotateCcw size={16} /> Reset
            </button>
            <button className="btn-primary" onClick={compileFinalReport}>
              Generate Report <Check size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ----------------- STEP 4: GLOW DOWNLOAD ----------------- */}
      {step === 4 && (
        <div className="success-card">
          <div className="success-check-badge">
            <CheckCircle2 size={40} />
          </div>
          <h3 className="success-title">Document Compiled!</h3>
          <p className="success-desc">
            The values have been written into the placeholders. Your completed adjuster Word report is ready for download.
          </p>
          
          {downloadUrl && (
            <a 
              href={downloadUrl} 
              download="Completed_Claims_Report.docx"
              style={{ textDecoration: 'none' }}
            >
              <button className="btn-primary" style={{ padding: '16px 40px', gap: '10px' }}>
                <Download size={18} /> Download Word Report
              </button>
            </a>
          )}

          <button 
            className="btn-secondary" 
            style={{ marginTop: '16px' }}
            onClick={startNewReport}
          >
            Process Another Template
          </button>
        </div>
      )}
    </main>
  );
}
