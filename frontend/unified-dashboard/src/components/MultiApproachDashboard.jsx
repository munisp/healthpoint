import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, LineChart, Line, ScatterChart, Scatter } from 'recharts';

const MultiApproachDashboard = () => {
  const [selectedApproaches, setSelectedApproaches] = useState(['georgetown', 'proprietary', 'hybrid']);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [caseData, setCaseData] = useState({
    case_id: 'DEMO_001',
    specialty: 'neurology',
    case_complexity: 0.85,
    billed_amount: 450000,
    qpa_amount: 125000,
    emergency_status: true,
    provider_volume: 75000,
    quality_score: 0.88
  });

  // Mock analysis results for demonstration
  const mockResults = {
    individual_results: {
      georgetown: {
        methodology: "Georgetown AI-MCMC Enhanced",
        result: {
          win_probability: 0.95,
          qpa_multiplier: 13.93,
          confidence_score: 0.68,
          methodology: "Georgetown AI-MCMC Enhanced",
          foundation: "586,581 case academic analysis"
        },
        processing_time: 0.00001,
        status: "success"
      },
      proprietary: {
        methodology: "HealthPoint Proprietary Intelligence",
        result: {
          win_probability: 0.803,
          qpa_multiplier: 3.71,
          confidence_score: 0.906,
          methodology: "HealthPoint Proprietary Intelligence",
          innovation_score: 1.0
        },
        processing_time: 0.00022,
        status: "success"
      },
      hybrid: {
        methodology: "Georgetown-Validated Proprietary Intelligence",
        result: {
          win_probability: 0.891,
          qpa_multiplier: 9.84,
          confidence_score: 0.77,
          methodology: "Georgetown-Validated Proprietary Intelligence",
          balance_score: 1.0
        },
        processing_time: 0.00009,
        status: "success"
      }
    },
    comparative_analysis: {
      summary_statistics: {
        win_probability: {
          mean: 0.882,
          std: 0.074,
          min: 0.803,
          max: 0.95,
          range: 0.147
        }
      },
      best_performers: {
        highest_accuracy: { approach: "georgetown", win_probability: 0.95 },
        highest_confidence: { approach: "proprietary", confidence_score: 0.906 },
        fastest_processing: { approach: "georgetown", processing_time: 0.00001 }
      },
      consensus_metrics: {
        consensus_win_probability: 0.882,
        agreement_level: "moderate"
      }
    },
    recommendations: {
      high_stakes: {
        recommended_approach: "hybrid",
        reason: "High-value/complex case benefits from academic credibility + superior performance"
      },
      competitive: {
        recommended_approach: "proprietary", 
        reason: "Competitive advantage requires superior accuracy and real-time intelligence"
      },
      default: {
        recommended_approach: "hybrid",
        reason: "Optimal balance of credibility, performance, and risk mitigation"
      }
    }
  };

  const approachInfo = {
    georgetown: {
      name: "Georgetown AI-MCMC Enhanced",
      description: "Academic research-backed with AI enhancement",
      color: "#1f77b4",
      strengths: ["Academic credibility", "Peer-reviewed methodology", "Government recognition"],
      icon: "🎓"
    },
    proprietary: {
      name: "HealthPoint Proprietary Intelligence", 
      description: "Next-generation multi-engine intelligence",
      color: "#ff7f0e",
      strengths: ["Real-time intelligence", "Superior accuracy", "Behavioral economics"],
      icon: "🚀"
    },
    hybrid: {
      name: "Georgetown-Validated Proprietary Intelligence",
      description: "Best of both worlds - credibility + performance", 
      color: "#2ca02c",
      strengths: ["Academic validation", "Superior performance", "Risk mitigation"],
      icon: "⚖️"
    }
  };

  const comparisonMatrix = {
    georgetown: { accuracy: 85, speed: 95, credibility: 100, innovation: 70, real_time: 30, customization: 40 },
    proprietary: { accuracy: 97, speed: 98, credibility: 70, innovation: 100, real_time: 100, customization: 95 },
    hybrid: { accuracy: 93, speed: 96, credibility: 90, innovation: 85, real_time: 80, customization: 85 }
  };

  useEffect(() => {
    // Simulate loading and set mock results
    setLoading(true);
    setTimeout(() => {
      setAnalysisResults(mockResults);
      setLoading(false);
    }, 1000);
  }, [selectedApproaches]);

  const runAnalysis = () => {
    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setAnalysisResults(mockResults);
      setLoading(false);
    }, 2000);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatPercentage = (value) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  // Prepare chart data
  const performanceData = selectedApproaches.map(approach => {
    const result = analysisResults?.individual_results[approach]?.result;
    return {
      approach: approachInfo[approach].name,
      shortName: approach,
      winProbability: result ? result.win_probability * 100 : 0,
      qpaMultiplier: result ? result.qpa_multiplier : 0,
      confidence: result ? result.confidence_score * 100 : 0,
      expectedAward: result ? caseData.qpa_amount * result.qpa_multiplier : 0,
      color: approachInfo[approach].color
    };
  });

  const radarData = Object.keys(comparisonMatrix).map(approach => ({
    approach: approachInfo[approach].name,
    ...comparisonMatrix[approach]
  }));

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🏆 Multi-Approach IDR Intelligence Platform
          </h1>
          <p className="text-lg text-gray-600">
            Compare Georgetown, Proprietary, and Hybrid methodologies for optimal IDR outcomes
          </p>
        </div>

        {/* Case Configuration */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">📋 Case Configuration</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Specialty</label>
              <select 
                value={caseData.specialty}
                onChange={(e) => setCaseData({...caseData, specialty: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md"
              >
                <option value="neurology">Neurology</option>
                <option value="surgery">Surgery</option>
                <option value="radiology">Radiology</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Complexity</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={caseData.case_complexity}
                onChange={(e) => setCaseData({...caseData, case_complexity: parseFloat(e.target.value)})}
                className="w-full"
              />
              <span className="text-sm text-gray-500">{formatPercentage(caseData.case_complexity)}</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Billed Amount</label>
              <input
                type="number"
                value={caseData.billed_amount}
                onChange={(e) => setCaseData({...caseData, billed_amount: parseInt(e.target.value)})}
                className="w-full p-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">QPA Amount</label>
              <input
                type="number"
                value={caseData.qpa_amount}
                onChange={(e) => setCaseData({...caseData, qpa_amount: parseInt(e.target.value)})}
                className="w-full p-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Emergency</label>
              <input
                type="checkbox"
                checked={caseData.emergency_status}
                onChange={(e) => setCaseData({...caseData, emergency_status: e.target.checked})}
                className="mt-2"
              />
            </div>
            <div>
              <button
                onClick={runAnalysis}
                disabled={loading}
                className="w-full bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Analyzing...' : 'Run Analysis'}
              </button>
            </div>
          </div>
        </div>

        {/* Approach Selection */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">🔬 Select Approaches to Compare</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(approachInfo).map(([key, info]) => (
              <div key={key} className="border rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <input
                    type="checkbox"
                    id={key}
                    checked={selectedApproaches.includes(key)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedApproaches([...selectedApproaches, key]);
                      } else {
                        setSelectedApproaches(selectedApproaches.filter(a => a !== key));
                      }
                    }}
                    className="mr-2"
                  />
                  <span className="text-2xl mr-2">{info.icon}</span>
                  <label htmlFor={key} className="font-medium">{info.name}</label>
                </div>
                <p className="text-sm text-gray-600 mb-2">{info.description}</p>
                <div className="text-xs">
                  <strong>Strengths:</strong>
                  <ul className="list-disc list-inside">
                    {info.strengths.map((strength, idx) => (
                      <li key={idx}>{strength}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>

        {loading && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-lg">Running multi-approach analysis...</p>
          </div>
        )}

        {analysisResults && !loading && (
          <>
            {/* Performance Comparison */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">📊 Performance Comparison</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-medium mb-2">Win Probability & Confidence</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={performanceData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="shortName" />
                      <YAxis />
                      <Tooltip formatter={(value, name) => [
                        name === 'winProbability' || name === 'confidence' ? `${value.toFixed(1)}%` : value.toFixed(2),
                        name === 'winProbability' ? 'Win Probability' : name === 'confidence' ? 'Confidence' : name
                      ]} />
                      <Legend />
                      <Bar dataKey="winProbability" fill="#1f77b4" name="Win Probability %" />
                      <Bar dataKey="confidence" fill="#ff7f0e" name="Confidence %" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <h3 className="text-lg font-medium mb-2">Expected Awards</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={performanceData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="shortName" />
                      <YAxis tickFormatter={(value) => `$${(value/1000).toFixed(0)}K`} />
                      <Tooltip formatter={(value) => [formatCurrency(value), 'Expected Award']} />
                      <Bar dataKey="expectedAward" fill="#2ca02c" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Detailed Results */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">🔍 Detailed Results</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {selectedApproaches.map(approach => {
                  const result = analysisResults.individual_results[approach];
                  if (!result || result.status !== 'success') return null;
                  
                  const res = result.result;
                  const info = approachInfo[approach];
                  
                  return (
                    <div key={approach} className="border rounded-lg p-4" style={{borderColor: info.color}}>
                      <div className="flex items-center mb-3">
                        <span className="text-2xl mr-2">{info.icon}</span>
                        <h3 className="font-semibold" style={{color: info.color}}>{info.name}</h3>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span>Win Probability:</span>
                          <span className="font-medium">{formatPercentage(res.win_probability)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>QPA Multiplier:</span>
                          <span className="font-medium">{res.qpa_multiplier.toFixed(2)}x</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Expected Award:</span>
                          <span className="font-medium">{formatCurrency(caseData.qpa_amount * res.qpa_multiplier)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Confidence:</span>
                          <span className="font-medium">{formatPercentage(res.confidence_score)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Processing Time:</span>
                          <span className="font-medium">{(result.processing_time * 1000).toFixed(2)}ms</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Comparative Analysis */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">📈 Comparative Analysis</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-medium mb-2">Consensus Metrics</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Consensus Win Probability:</span>
                      <span className="font-medium">{formatPercentage(analysisResults.comparative_analysis.consensus_metrics.consensus_win_probability)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Prediction Range:</span>
                      <span className="font-medium">
                        {formatPercentage(analysisResults.comparative_analysis.summary_statistics.win_probability.min)} - {formatPercentage(analysisResults.comparative_analysis.summary_statistics.win_probability.max)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Agreement Level:</span>
                      <span className="font-medium capitalize">{analysisResults.comparative_analysis.consensus_metrics.agreement_level}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-medium mb-2">Best Performers</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Highest Accuracy:</span>
                      <span className="font-medium">{analysisResults.comparative_analysis.best_performers.highest_accuracy.approach} ({formatPercentage(analysisResults.comparative_analysis.best_performers.highest_accuracy.win_probability)})</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Highest Confidence:</span>
                      <span className="font-medium">{analysisResults.comparative_analysis.best_performers.highest_confidence.approach} ({formatPercentage(analysisResults.comparative_analysis.best_performers.highest_confidence.confidence_score)})</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Fastest Processing:</span>
                      <span className="font-medium">{analysisResults.comparative_analysis.best_performers.fastest_processing.approach} ({(analysisResults.comparative_analysis.best_performers.fastest_processing.processing_time * 1000).toFixed(2)}ms)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Approach Comparison Matrix */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">🎯 Approach Comparison Matrix</h2>
              <ResponsiveContainer width="100%" height={400}>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="approach" />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} />
                  <Radar name="Georgetown" dataKey="georgetown" stroke="#1f77b4" fill="#1f77b4" fillOpacity={0.1} />
                  <Radar name="Proprietary" dataKey="proprietary" stroke="#ff7f0e" fill="#ff7f0e" fillOpacity={0.1} />
                  <Radar name="Hybrid" dataKey="hybrid" stroke="#2ca02c" fill="#2ca02c" fillOpacity={0.1} />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Recommendations */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">💡 Approach Recommendations</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Object.entries(analysisResults.recommendations).map(([type, rec]) => (
                  <div key={type} className="border rounded-lg p-4">
                    <h3 className="font-medium mb-2 capitalize">{type.replace('_', ' ')}</h3>
                    <div className="flex items-center mb-2">
                      <span className="text-xl mr-2">{approachInfo[rec.recommended_approach].icon}</span>
                      <span className="font-medium">{approachInfo[rec.recommended_approach].name}</span>
                    </div>
                    <p className="text-sm text-gray-600">{rec.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MultiApproachDashboard;
