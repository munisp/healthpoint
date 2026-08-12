import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';

const GeorgetownEnhancedDashboard = () => {
  const [platformStatus, setPlatformStatus] = useState(null);
  const [georgetownMetrics, setGeorgetownMetrics] = useState(null);
  const [serviceHealth, setServiceHealth] = useState(null);
  const [realtimeData, setRealtimeData] = useState({
    currentLoad: 0.156,
    casesInQueue: 42,
    avgProcessingTime: 2847,
    successRate: 94.2
  });
  const [selectedTimeframe, setSelectedTimeframe] = useState('24h');
  const [loading, setLoading] = useState(true);

  // Simulated data based on Georgetown research insights
  const georgetownInsights = {
    challengeReductionPotential: 45,
    accuracyImprovements: {
      automatedNetworkVerification: 15,
      enhancedGfeValidation: 12,
      timingRuleAutomation: 18,
      geographicRuleEngine: 10,
      specialtySpecificRules: 20
    },
    stateComplexity: {
      TX: { complexity: 'high', cases: 12847 },
      FL: { complexity: 'medium', cases: 8932 },
      AZ: { complexity: 'medium', cases: 6421 },
      CA: { complexity: 'high', cases: 15632 },
      NY: { complexity: 'high', cases: 11234 }
    },
    specialtyPerformance: [
      { specialty: 'Radiology', winRate: 88, avgQPA: 1222, cases: 45231 },
      { specialty: 'Emergency', winRate: 92, avgQPA: 450, cases: 32145 },
      { specialty: 'Surgery', winRate: 85, avgQPA: 1818, cases: 28934 },
      { specialty: 'Neurology', winRate: 90, avgQPA: 1222, cases: 15678 },
      { specialty: 'Anesthesiology', winRate: 87, avgQPA: 890, cases: 19823 }
    ]
  };

  const volumeData = [
    { month: 'Jan', cases: 48234, resolved: 45123, pending: 3111 },
    { month: 'Feb', cases: 52341, resolved: 49876, pending: 2465 },
    { month: 'Mar', cases: 58923, resolved: 55234, pending: 3689 },
    { month: 'Apr', cases: 61245, resolved: 57891, pending: 3354 },
    { month: 'May', cases: 65432, resolved: 62108, pending: 3324 },
    { month: 'Jun', cases: 69876, resolved: 66543, pending: 3333 }
  ];

  const entityPerformanceData = [
    { entity: 'Healthcare Resolution LLC', winRate: 94, cases: 1234, avgTime: 28 },
    { entity: 'Medical Arbitration Services', winRate: 89, cases: 987, avgTime: 32 },
    { entity: 'Independent Health Decisions', winRate: 91, cases: 1456, avgTime: 25 },
    { entity: 'Dispute Resolution Partners', winRate: 87, cases: 876, avgTime: 35 },
    { entity: 'Healthcare Mediation Group', winRate: 93, cases: 1123, avgTime: 27 }
  ];

  const challengeReductionData = [
    { category: 'Network Verification', before: 23, after: 8, improvement: 65 },
    { category: 'GFE Validation', before: 18, after: 7, improvement: 61 },
    { category: 'Timing Requirements', before: 15, after: 4, improvement: 73 },
    { category: 'Geographic Rules', before: 12, after: 6, improvement: 50 },
    { category: 'Specialty Rules', before: 20, after: 6, improvement: 70 }
  ];

  useEffect(() => {
    // Simulate API calls to fetch real data
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Simulate API delays
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Mock API responses
        setPlatformStatus({
          version: '2.0.0',
          georgetownEnhanced: true,
          totalServices: 5,
          healthyServices: 5,
          uptime: '99.9%'
        });

        setServiceHealth({
          'volume-management': { status: 'healthy', responseTime: 45 },
          'predictive-analytics': { status: 'healthy', responseTime: 67 },
          'entity-selection': { status: 'healthy', responseTime: 52 },
          'third-party-integration': { status: 'healthy', responseTime: 38 },
          'eligibility-validation': { status: 'healthy', responseTime: 71 }
        });

        setGeorgetownMetrics({
          totalCasesProcessed: 586581,
          averageProcessingTime: 2847,
          successRate: 94.2,
          challengeReduction: 45
        });

        setLoading(false);
      } catch (error) {
        console.error('Error fetching data:', error);
        setLoading(false);
      }
    };

    fetchData();
    
    // Set up real-time updates
    const interval = setInterval(() => {
      setRealtimeData(prev => ({
        ...prev,
        currentLoad: Math.max(0.1, Math.min(0.9, prev.currentLoad + (Math.random() - 0.5) * 0.1)),
        casesInQueue: Math.max(0, prev.casesInQueue + Math.floor((Math.random() - 0.5) * 10)),
        avgProcessingTime: Math.max(1000, prev.avgProcessingTime + Math.floor((Math.random() - 0.5) * 200)),
        successRate: Math.max(85, Math.min(99, prev.successRate + (Math.random() - 0.5) * 2))
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy': return 'text-green-600';
      case 'degraded': return 'text-yellow-600';
      case 'unhealthy': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getLoadColor = (load) => {
    if (load < 0.3) return 'bg-green-500';
    if (load < 0.7) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-lg">Loading Georgetown Enhanced Platform...</span>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Georgetown-Enhanced IDR Platform Dashboard
        </h1>
        <p className="text-gray-600">
          Comprehensive monitoring and control center for all Georgetown University research-enhanced services
        </p>
        <div className="mt-4 flex items-center space-x-4">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
            ✓ Georgetown Enhanced
          </span>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
            Platform v{platformStatus?.version}
          </span>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800">
            Uptime: {platformStatus?.uptime}
          </span>
        </div>
      </div>

      {/* Real-time Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-bold">L</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Current Load</p>
              <p className="text-2xl font-bold text-gray-900">{(realtimeData.currentLoad * 100).toFixed(1)}%</p>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div 
                  className={`h-2 rounded-full ${getLoadColor(realtimeData.currentLoad)}`}
                  style={{ width: `${realtimeData.currentLoad * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-bold">Q</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Cases in Queue</p>
              <p className="text-2xl font-bold text-gray-900">{realtimeData.casesInQueue}</p>
              <p className="text-sm text-gray-500">Auto-scaling active</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-bold">T</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Avg Processing Time</p>
              <p className="text-2xl font-bold text-gray-900">{(realtimeData.avgProcessingTime / 1000).toFixed(1)}s</p>
              <p className="text-sm text-green-600">↓ 18% improvement</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-bold">S</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Success Rate</p>
              <p className="text-2xl font-bold text-gray-900">{realtimeData.successRate.toFixed(1)}%</p>
              <p className="text-sm text-green-600">Georgetown enhanced</p>
            </div>
          </div>
        </div>
      </div>

      {/* Service Health Status */}
      <div className="bg-white rounded-lg shadow mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Service Health Status</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {serviceHealth && Object.entries(serviceHealth).map(([service, health]) => (
              <div key={service} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-900 capitalize">
                    {service.replace('-', ' ')}
                  </h3>
                  <span className={`text-sm font-medium ${getStatusColor(health.status)}`}>
                    {health.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500">Response: {health.responseTime}ms</p>
                <div className="mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-1">
                    <div 
                      className={`h-1 rounded-full ${health.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ width: health.status === 'healthy' ? '100%' : '30%' }}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Georgetown Research Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Georgetown Challenge Reduction</h2>
            <p className="text-sm text-gray-600">Based on Georgetown University research findings</p>
          </div>
          <div className="p-6">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={challengeReductionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="before" fill="#ef4444" name="Before Enhancement" />
                <Bar dataKey="after" fill="#10b981" name="After Enhancement" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Specialty Performance Analysis</h2>
            <p className="text-sm text-gray-600">Provider win rates by medical specialty</p>
          </div>
          <div className="p-6">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={georgetownInsights.specialtyPerformance}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="specialty" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="winRate" fill="#3b82f6" name="Win Rate %" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Volume Management and Entity Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Volume Management Trends</h2>
            <p className="text-sm text-gray-600">Case volume and resolution tracking</p>
          </div>
          <div className="p-6">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="cases" stackId="1" stroke="#3b82f6" fill="#3b82f6" name="Total Cases" />
                <Area type="monotone" dataKey="resolved" stackId="2" stroke="#10b981" fill="#10b981" name="Resolved" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">IDR Entity Performance</h2>
            <p className="text-sm text-gray-600">Georgetown bias-aware entity selection results</p>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {entityPerformanceData.map((entity, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">{entity.entity}</h3>
                    <p className="text-xs text-gray-500">{entity.cases} cases • {entity.avgTime} days avg</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-green-600">{entity.winRate}%</p>
                    <p className="text-xs text-gray-500">Win Rate</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Georgetown Accuracy Improvements */}
      <div className="bg-white rounded-lg shadow mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Georgetown Accuracy Improvements</h2>
          <p className="text-sm text-gray-600">Validation accuracy improvements by enhancement type</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {Object.entries(georgetownInsights.accuracyImprovements).map(([improvement, percentage]) => (
              <div key={improvement} className="text-center p-4 border rounded-lg">
                <div className="text-2xl font-bold text-blue-600 mb-2">+{percentage}%</div>
                <div className="text-sm text-gray-600 capitalize">
                  {improvement.replace(/([A-Z])/g, ' $1').trim()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* State Complexity Analysis */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">State Complexity Analysis</h2>
          <p className="text-sm text-gray-600">Georgetown research-based state complexity mapping</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {Object.entries(georgetownInsights.stateComplexity).map(([state, data]) => (
              <div key={state} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-bold text-gray-900">{state}</h3>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    data.complexity === 'high' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {data.complexity}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{data.cases.toLocaleString()} cases</p>
                <div className="mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${data.complexity === 'high' ? 'bg-red-500' : 'bg-yellow-500'}`}
                      style={{ width: data.complexity === 'high' ? '100%' : '70%' }}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-sm text-gray-500">
        <p>Georgetown-Enhanced IDR Platform • Research-driven healthcare dispute resolution</p>
        <p>Based on Georgetown University Center on Health Insurance Reforms analysis</p>
      </div>
    </div>
  );
};
    current_load: 0.156,  // 15.6% load
    peak_capacity: 1000000,
    auto_scaling_active: true,
    queued_cases: 12450,
    processing_cases: 3200,
    completed_cases_today: 8934,
    processing_rate: 15600.0,
    deadline_alerts: 1867,
    geographic_distribution: {
      'TX': 3112, 'FL': 2241, 'AZ': 1494, 'TN': 996, 'GA': 872,
      'NJ': 747, 'NY': 623, 'CA': 498, 'OH': 374, 'PA': 249
    },
    specialty_distribution: {
      'radiology': 4200, 'emergency': 3800, 'neurology': 2100,
      'surgery': 1900, 'anesthesiology': 1500, 'pathology': 1200,
      'general': 800
    }
  });

  const [scalingConfig, setScalingConfig] = useState({
    threshold: 0.8,
    scale_up_factor: 1.5,
    scale_down_factor: 0.7,
    min_instances: 5,
    max_instances: 500,
    cooldown_period: 300
  });

  const [processingInstances, setProcessingInstances] = useState(15);
  const [isAutoScaling, setIsAutoScaling] = useState(true);

  const [predictiveAnalytics, setPredictiveAnalytics] = useState({
    providerWinProbability: 88,
    recommendedStrategy: "Aggressive negotiation stance",
    optimalOfferRange: { min: 320, max: 450 },
    confidenceScore: 94
  });

  const [entityPerformance, setEntityPerformance] = useState([
    { name: "Healthcare Resolution LLC", winRate: 92, avgTime: 28, bias: "Low" },
    { name: "Medical Dispute Services", winRate: 91, avgTime: 32, bias: "Low" },
    { name: "Independent Medical Review", winRate: 33, avgTime: 25, bias: "High" },
    { name: "Arbitration Forums Inc", winRate: 94, avgTime: 30, bias: "Low" }
  ]);

  const [eligibilityMetrics, setEligibilityMetrics] = useState({
    validationAccuracy: 95.5,
    challengeReductionRate: 45,
    autoValidatedCases: 8934,
    flaggedCases: 234
  });

  const [deadlineAlerts, setDeadlineAlerts] = useState([
    { case_id: "IDR-20251009-1001", deadline: "2025-10-10T15:00:00Z", time_remaining: "6 hours", priority: "EMERGENCY", alert_type: "critical" },
    { case_id: "IDR-20251009-1002", deadline: "2025-10-11T12:00:00Z", time_remaining: "1 day", priority: "URGENT", alert_type: "warning" },
    { case_id: "IDR-20251009-1003", deadline: "2025-10-12T09:00:00Z", time_remaining: "2 days", priority: "HIGH", alert_type: "warning" }
  ]);

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate processing of cases
      setVolumeMetrics(prev => ({
        ...prev,
        queued_cases: Math.max(0, prev.queued_cases - Math.floor(Math.random() * 50)),
        processing_cases: prev.processing_cases + Math.floor(Math.random() * 20) - 10,
        completed_cases_today: prev.completed_cases_today + Math.floor(Math.random() * 30),
        current_load: Math.max(0, prev.current_load + (Math.random() - 0.5) * 0.01)
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const handleScaleUp = async () => {
    setProcessingInstances(prev => Math.min(prev + 5, scalingConfig.max_instances));
  };

  const handleScaleDown = async () => {
    setProcessingInstances(prev => Math.max(prev - 5, scalingConfig.min_instances));
  };

  const toggleAutoScaling = () => {
    setIsAutoScaling(prev => !prev);
    setVolumeMetrics(prev => ({ ...prev, auto_scaling_active: !prev.auto_scaling_active }));
  };

  const handleVolumeSurge = async (surgeType) => {
    const newCases = surgeType === 'emergency' ? 5000 : surgeType === 'seasonal' ? 2000 : 1000;
    setVolumeMetrics(prev => ({
      ...prev,
      queued_cases: prev.queued_cases + newCases,
      current_load: Math.min(1.0, prev.current_load + (newCases / prev.peak_capacity))
    }));
  };

  const refreshMetrics = async () => {
    // Simulate API call to refresh metrics
    setVolumeMetrics(prev => ({
      ...prev,
      current_load: Math.random() * 0.3 + 0.1, // 10-40% load
      queued_cases: Math.floor(Math.random() * 20000) + 5000,
      processing_cases: Math.floor(Math.random() * 5000) + 1000
    }));
  };

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Georgetown-Enhanced IDR Platform</h1>
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="text-green-600 border-green-600">
            <CheckCircle className="w-4 h-4 mr-1" />
            All Systems Operational
          </Badge>
          <Button onClick={refreshMetrics} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Volume Management Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Load</CardTitle>
            <Activity className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(volumeMetrics.current_load * 100).toFixed(1)}%</div>
            <Progress value={volumeMetrics.current_load * 100} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-2">
              Auto-scaling {volumeMetrics.auto_scaling_active ? 'active' : 'inactive'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Queued Cases</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{volumeMetrics.queued_cases.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Processing: {volumeMetrics.processing_cases.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Processing Rate</CardTitle>
            <Zap className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{volumeMetrics.processing_rate.toLocaleString()}/hr</div>
            <p className="text-xs text-muted-foreground">
              Instances: {processingInstances}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deadline Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{volumeMetrics.deadline_alerts}</div>
            <p className="text-xs text-muted-foreground">
              Approaching deadline
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Volume Management Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Server className="w-5 h-5 mr-2" />
            Volume Management & Auto-Scaling Controls
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h4 className="font-semibold mb-4">Scaling Controls</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Auto-scaling</span>
                  <Button
                    onClick={toggleAutoScaling}
                    variant={isAutoScaling ? "default" : "outline"}
                    size="sm"
                  >
                    {isAutoScaling ? <Pause className="w-4 h-4 mr-1" /> : <Play className="w-4 h-4 mr-1" />}
                    {isAutoScaling ? 'Disable' : 'Enable'}
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Processing Instances</span>
                  <div className="flex items-center space-x-2">
                    <Button onClick={handleScaleDown} variant="outline" size="sm">
                      <ArrowDown className="w-4 h-4" />
                    </Button>
                    <span className="font-bold">{processingInstances}</span>
                    <Button onClick={handleScaleUp} variant="outline" size="sm">
                      <ArrowUp className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Range: {scalingConfig.min_instances} - {scalingConfig.max_instances} instances
                </div>
              </div>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Volume Surge Testing</h4>
              <div className="space-y-2">
                <Button 
                  onClick={() => handleVolumeSurge('normal')} 
                  variant="outline" 
                  className="w-full"
                >
                  Normal Surge (+1K cases)
                </Button>
                <Button 
                  onClick={() => handleVolumeSurge('seasonal')} 
                  variant="outline" 
                  className="w-full"
                >
                  Seasonal Surge (+2K cases)
                </Button>
                <Button 
                  onClick={() => handleVolumeSurge('emergency')} 
                  variant="destructive" 
                  className="w-full"
                >
                  Emergency Surge (+5K cases)
                </Button>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-4">System Status</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Peak Capacity</span>
                  <span className="font-bold">{volumeMetrics.peak_capacity.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Completed Today</span>
                  <span className="font-bold text-green-600">{volumeMetrics.completed_cases_today.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Load Threshold</span>
                  <span className="font-bold">{(scalingConfig.threshold * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deadline Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Timer className="w-5 h-5 mr-2" />
            Deadline Management & Critical Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {deadlineAlerts.map((alert, index) => (
              <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <AlertTriangle className={`h-5 w-5 ${alert.alert_type === 'critical' ? 'text-red-500' : 'text-yellow-500'}`} />
                  <div>
                    <h4 className="font-semibold">{alert.case_id}</h4>
                    <p className="text-sm text-muted-foreground">
                      Deadline: {new Date(alert.deadline).toLocaleString()} ({alert.time_remaining} remaining)
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge variant={alert.priority === 'EMERGENCY' ? 'destructive' : 'default'}>
                    {alert.priority}
                  </Badge>
                  <Button variant="outline" size="sm">
                    Prioritize
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Geographic Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <MapPin className="w-5 h-5 mr-2" />
              Geographic Distribution (Georgetown High-Volume States)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(volumeMetrics.geographic_distribution)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 7)
                .map(([state, count]) => (
                <div key={state} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{state}</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-20 bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full" 
                        style={{ width: `${(count / Math.max(...Object.values(volumeMetrics.geographic_distribution))) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-bold">{count.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Stethoscope className="w-5 h-5 mr-2" />
              Specialty Distribution (Georgetown Patterns)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(volumeMetrics.specialty_distribution)
                .sort(([,a], [,b]) => b - a)
                .map(([specialty, count]) => (
                <div key={specialty} className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize">{specialty}</span>
                  <div className="flex items-center space-x-2">
                    <div className="w-20 bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-green-600 h-2 rounded-full" 
                        style={{ width: `${(count / Math.max(...Object.values(volumeMetrics.specialty_distribution))) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-bold">{count.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Predictive Analytics Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <BarChart3 className="w-5 h-5 mr-2" />
            Georgetown-Based Predictive Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h4 className="font-semibold mb-2">Recommended Strategy</h4>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {predictiveAnalytics.recommendedStrategy}
                </AlertDescription>
              </Alert>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Optimal QPA Range</h4>
              <div className="text-lg font-bold">
                {predictiveAnalytics.optimalOfferRange.min}% - {predictiveAnalytics.optimalOfferRange.max}%
              </div>
              <p className="text-sm text-muted-foreground">Based on specialty patterns</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Market Intelligence</h4>
              <div className="space-y-1">
                <div className="text-sm">Neurology: 1222% QPA avg</div>
                <div className="text-sm">Surgery: 1818% QPA avg</div>
                <div className="text-sm">Radiology: 631% QPA avg</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* IDR Entity Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Users className="w-5 h-5 mr-2" />
            IDR Entity Performance & Selection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {entityPerformance.map((entity, index) => (
              <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex-1">
                  <h4 className="font-semibold">{entity.name}</h4>
                  <div className="flex items-center space-x-4 mt-1">
                    <span className="text-sm text-muted-foreground">
                      Win Rate: {entity.winRate}%
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Avg Time: {entity.avgTime} days
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge 
                    variant={entity.bias === "Low" ? "default" : "destructive"}
                  >
                    {entity.bias} Bias
                  </Badge>
                  <Button size="sm" variant="outline">
                    Select
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Enhanced Eligibility Validation */}
      <Card>
        <CardHeader>
          <CardTitle>Enhanced Eligibility Validation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-4">Validation Metrics</h4>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Auto-validated Cases</span>
                  <span className="font-bold">{eligibilityMetrics.autoValidatedCases.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Flagged for Review</span>
                  <span className="font-bold text-orange-600">{eligibilityMetrics.flaggedCases}</span>
                </div>
                <div className="flex justify-between">
                  <span>Challenge Reduction</span>
                  <span className="font-bold text-green-600">-{eligibilityMetrics.challengeReductionRate}%</span>
                </div>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Quick Actions</h4>
              <div className="space-y-2">
                <Button className="w-full" variant="outline">
                  Run Bulk Validation
                </Button>
                <Button className="w-full" variant="outline">
                  Review Flagged Cases
                </Button>
                <Button className="w-full" variant="outline">
                  Generate Compliance Report
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default GeorgetownEnhancedDashboard;
