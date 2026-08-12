import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ScatterPlot, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Activity, TrendingUp, MapPin, Plane, Package, AlertTriangle,
  CheckCircle, Clock, DollarSign, BarChart3, Globe, Zap
} from 'lucide-react';

const PUFEnhancedDashboard = () => {
  const [dashboardData, setDashboardData] = useState({
    summary: {
      total_records: 0,
      total_disputes: 0,
      overall_provider_win_rate: 0,
      avg_payment_pct_qpa: 0,
      georgetown_validation: {
        expected_win_rate: 0.88,
        actual_win_rate: 0,
        variance: 0
      },
      health_affairs_validation: {
        pe_organization_cases: 0,
        pe_win_rate: 0,
        entity_bias_detected: false
      }
    },
    geographic_analysis: {
      state_analysis: {},
      msa_analysis: {},
      complexity_validation: {}
    },
    air_ambulance_analysis: {
      vehicle_analysis: {},
      capacity_analysis: {},
      comparison: {}
    },
    bundled_analysis: {
      performance_comparison: {},
      bundling_efficiency: {},
      recommendations: []
    },
    model_performance: {
      outcome_prediction: { accuracy: 0 },
      payment_prediction: { mae: 0 }
    }
  });

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  // Mock data for demonstration (in production, this would come from API)
  useEffect(() => {
    const mockData = {
      summary: {
        total_records: 45672,
        total_disputes: 12834,
        overall_provider_win_rate: 0.847,
        avg_payment_pct_qpa: 387.5,
        georgetown_validation: {
          expected_win_rate: 0.88,
          actual_win_rate: 0.847,
          variance: 0.033
        },
        health_affairs_validation: {
          pe_organization_cases: 8934,
          pe_win_rate: 0.923,
          entity_bias_detected: true
        }
      },
      geographic_analysis: {
        state_analysis: {
          'TX': { provider_win_rate: 0.89, avg_payment_pct_qpa: 425.3, total_cases: 8934, avg_qpa: 1250 },
          'CA': { provider_win_rate: 0.82, avg_payment_pct_qpa: 398.7, total_cases: 7234, avg_qpa: 1450 },
          'FL': { provider_win_rate: 0.91, avg_payment_pct_qpa: 445.2, total_cases: 5678, avg_qpa: 1180 },
          'NY': { provider_win_rate: 0.78, avg_payment_pct_qpa: 356.8, total_cases: 4567, avg_qpa: 1680 },
          'AZ': { provider_win_rate: 0.85, avg_payment_pct_qpa: 412.1, total_cases: 3456, avg_qpa: 1320 }
        },
        complexity_validation: {
          'high': { provider_win_rate: 0.83, avg_payment_pct_qpa: 402.5, total_cases: 18456 },
          'medium': { provider_win_rate: 0.87, avg_payment_pct_qpa: 378.9, total_cases: 15234 },
          'low': { provider_win_rate: 0.89, avg_payment_pct_qpa: 365.2, total_cases: 11982 }
        }
      },
      air_ambulance_analysis: {
        comparison: {
          air_ambulance: {
            provider_win_rate: 0.92,
            avg_payment_pct_qpa: 523.7,
            total_cases: 2345
          },
          non_air_ambulance: {
            provider_win_rate: 0.84,
            avg_payment_pct_qpa: 378.2,
            total_cases: 43327
          }
        }
      },
      bundled_analysis: {
        performance_comparison: {
          bundled: { provider_win_rate: 0.89, avg_payment_pct_qpa: 412.3, total_cases: 5678 },
          single: { provider_win_rate: 0.83, avg_payment_pct_qpa: 378.9, total_cases: 32456 },
          batched: { provider_win_rate: 0.86, avg_payment_pct_qpa: 395.7, total_cases: 7538 }
        },
        bundling_efficiency: {
          avg_lines_per_bundled_dispute: 3.2,
          bundling_rate: 0.34,
          efficiency_score: 0.78
        },
        recommendations: [
          "Bundled disputes show higher provider win rates - consider bundling strategy",
          "Bundled disputes resolve faster - bundling improves efficiency"
        ]
      },
      model_performance: {
        outcome_prediction: { accuracy: 0.847 },
        payment_prediction: { mae: 23.5 }
      }
    };

    setTimeout(() => {
      setDashboardData(mockData);
      setLoading(false);
    }, 1000);
  }, []);

  const formatPercentage = (value) => `${(value * 100).toFixed(1)}%`;
  const formatCurrency = (value) => `$${value.toLocaleString()}`;
  const formatNumber = (value) => value.toLocaleString();

  const getComplianceColor = (variance) => {
    if (variance < 0.05) return 'text-green-600';
    if (variance < 0.10) return 'text-yellow-600';
    return 'text-red-600';
  };

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold">CMS PUF Enhanced Analytics Overview</h2>
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="bg-blue-50">
            Georgetown Research Integrated
          </Badge>
          <Badge variant="outline" className="bg-green-50">
            Health Affairs Enhanced
          </Badge>
          <Badge variant="outline" className="bg-purple-50">
            CMS PUF Compliant
          </Badge>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total PUF Records</CardTitle>
            <Activity className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(dashboardData.summary.total_records)}</div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(dashboardData.summary.total_disputes)} unique disputes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Provider Win Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatPercentage(dashboardData.summary.overall_provider_win_rate)}
            </div>
            <p className="text-xs text-muted-foreground">
              Georgetown baseline: {formatPercentage(dashboardData.summary.georgetown_validation.expected_win_rate)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Payment % QPA</CardTitle>
            <DollarSign className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {dashboardData.summary.avg_payment_pct_qpa.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Health Affairs range: 320-550%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Model Accuracy</CardTitle>
            <BarChart3 className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {formatPercentage(dashboardData.model_performance.outcome_prediction.accuracy)}
            </div>
            <p className="text-xs text-muted-foreground">
              Payment MAE: {dashboardData.model_performance.payment_prediction.mae}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Georgetown & Health Affairs Validation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Georgetown Research Validation</CardTitle>
            <CardDescription>Comparing actual PUF data with Georgetown University findings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Expected Win Rate</span>
              <span className="text-sm font-bold">
                {formatPercentage(dashboardData.summary.georgetown_validation.expected_win_rate)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Actual Win Rate</span>
              <span className="text-sm font-bold">
                {formatPercentage(dashboardData.summary.georgetown_validation.actual_win_rate)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Variance</span>
              <span className={`text-sm font-bold ${getComplianceColor(dashboardData.summary.georgetown_validation.variance)}`}>
                {formatPercentage(dashboardData.summary.georgetown_validation.variance)}
              </span>
            </div>
            <Progress 
              value={100 - (dashboardData.summary.georgetown_validation.variance * 1000)} 
              className="h-2" 
            />
            <p className="text-xs text-muted-foreground">
              {dashboardData.summary.georgetown_validation.variance < 0.05 ? 
                "✓ Strong alignment with Georgetown research" : 
                "⚠ Variance detected from Georgetown baseline"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Health Affairs Entity Bias Detection</CardTitle>
            <CardDescription>Private equity organization performance analysis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">PE Organization Cases</span>
              <span className="text-sm font-bold">
                {formatNumber(dashboardData.summary.health_affairs_validation.pe_organization_cases)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">PE Win Rate</span>
              <span className="text-sm font-bold text-red-600">
                {formatPercentage(dashboardData.summary.health_affairs_validation.pe_win_rate)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Entity Bias Detected</span>
              <span className="text-sm font-bold">
                {dashboardData.summary.health_affairs_validation.entity_bias_detected ? 
                  <Badge variant="destructive">Yes</Badge> : 
                  <Badge variant="secondary">No</Badge>}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {dashboardData.summary.health_affairs_validation.entity_bias_detected ? 
                "⚠ Significant entity bias variance detected (33-99% range)" : 
                "✓ No significant entity bias detected"}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderGeographicAnalysis = () => {
    const stateData = Object.entries(dashboardData.geographic_analysis.state_analysis || {})
      .map(([state, data]) => ({
        state,
        ...data,
        win_rate_pct: data.provider_win_rate * 100
      }))
      .sort((a, b) => b.total_cases - a.total_cases);

    const complexityData = Object.entries(dashboardData.geographic_analysis.complexity_validation || {})
      .map(([complexity, data]) => ({
        complexity,
        ...data,
        win_rate_pct: data.provider_win_rate * 100
      }));

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <MapPin className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Geographic Analysis</h1>
          </div>
          <Badge variant="outline">CMS PUF Geographic Data</Badge>
        </div>

        {/* State Performance Analysis */}
        <Card>
          <CardHeader>
            <CardTitle>State-Level Performance Analysis</CardTitle>
            <CardDescription>Provider win rates and payment patterns by state</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stateData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="state" />
                  <YAxis />
                  <Tooltip 
                    formatter={(value, name) => [
                      name === 'win_rate_pct' ? `${value.toFixed(1)}%` : 
                      name === 'avg_payment_pct_qpa' ? `${value.toFixed(1)}%` :
                      name === 'total_cases' ? value.toLocaleString() :
                      `$${value.toLocaleString()}`,
                      name === 'win_rate_pct' ? 'Win Rate' :
                      name === 'avg_payment_pct_qpa' ? 'Avg Payment % QPA' :
                      name === 'total_cases' ? 'Total Cases' : 'Avg QPA'
                    ]}
                  />
                  <Legend />
                  <Bar dataKey="win_rate_pct" fill="#10b981" name="Provider Win Rate %" />
                  <Bar dataKey="avg_payment_pct_qpa" fill="#f59e0b" name="Avg Payment % QPA" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Georgetown Complexity Validation */}
        <Card>
          <CardHeader>
            <CardTitle>Georgetown State Complexity Validation</CardTitle>
            <CardDescription>Performance by Georgetown-defined state complexity levels</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {complexityData.map((item) => (
                <div key={item.complexity} className="text-center p-4 border rounded-lg">
                  <div className="text-lg font-bold capitalize">{item.complexity} Complexity</div>
                  <div className="text-2xl font-bold text-blue-600 mt-2">
                    {formatPercentage(item.provider_win_rate)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatNumber(item.total_cases)} cases
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {item.avg_payment_pct_qpa.toFixed(1)}% avg payment
                  </div>
                </div>
              ))}
            </div>
            
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={complexityData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="complexity" />
                  <YAxis />
                  <Tooltip 
                    formatter={(value, name) => [
                      name === 'win_rate_pct' ? `${value.toFixed(1)}%` : `${value.toFixed(1)}%`,
                      name === 'win_rate_pct' ? 'Win Rate' : 'Avg Payment % QPA'
                    ]}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="win_rate_pct" stroke="#10b981" strokeWidth={3} name="Win Rate %" />
                  <Line type="monotone" dataKey="avg_payment_pct_qpa" stroke="#f59e0b" strokeWidth={3} name="Payment % QPA" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top Performing States */}
        <Card>
          <CardHeader>
            <CardTitle>Top Performing States</CardTitle>
            <CardDescription>States with highest case volumes and performance metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stateData.slice(0, 5).map((state, index) => (
                <div key={state.state} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-4">
                    <div className="text-2xl font-bold text-blue-600">#{index + 1}</div>
                    <div>
                      <div className="font-semibold">{state.state}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatNumber(state.total_cases)} cases
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{formatPercentage(state.provider_win_rate)}</div>
                    <div className="text-sm text-muted-foreground">
                      {state.avg_payment_pct_qpa.toFixed(1)}% avg payment
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderAirAmbulanceAnalysis = () => {
    const comparisonData = [
      {
        type: 'Air Ambulance',
        win_rate: dashboardData.air_ambulance_analysis.comparison?.air_ambulance?.provider_win_rate * 100 || 0,
        avg_payment: dashboardData.air_ambulance_analysis.comparison?.air_ambulance?.avg_payment_pct_qpa || 0,
        total_cases: dashboardData.air_ambulance_analysis.comparison?.air_ambulance?.total_cases || 0
      },
      {
        type: 'Non-Air Ambulance',
        win_rate: dashboardData.air_ambulance_analysis.comparison?.non_air_ambulance?.provider_win_rate * 100 || 0,
        avg_payment: dashboardData.air_ambulance_analysis.comparison?.non_air_ambulance?.avg_payment_pct_qpa || 0,
        total_cases: dashboardData.air_ambulance_analysis.comparison?.non_air_ambulance?.total_cases || 0
      }
    ];

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Plane className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Air Ambulance Analysis</h1>
          </div>
          <Badge variant="outline">CMS PUF Tab 2 Data</Badge>
        </div>

        {/* Air Ambulance vs Non-Air Ambulance Comparison */}
        <Card>
          <CardHeader>
            <CardTitle>Air Ambulance vs Standard Services Comparison</CardTitle>
            <CardDescription>Performance differences between air ambulance and other healthcare services</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {comparisonData.map((item) => (
                <div key={item.type} className="p-6 border rounded-lg">
                  <div className="flex items-center space-x-2 mb-4">
                    {item.type === 'Air Ambulance' ? 
                      <Plane className="h-5 w-5 text-blue-500" /> : 
                      <Activity className="h-5 w-5 text-green-500" />
                    }
                    <h3 className="font-semibold">{item.type}</h3>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm">Provider Win Rate</span>
                      <span className="font-bold">{item.win_rate.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Avg Payment % QPA</span>
                      <span className="font-bold">{item.avg_payment.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Total Cases</span>
                      <span className="font-bold">{formatNumber(item.total_cases)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" />
                  <YAxis />
                  <Tooltip 
                    formatter={(value, name) => [
                      name === 'win_rate' ? `${value.toFixed(1)}%` : 
                      name === 'avg_payment' ? `${value.toFixed(1)}%` :
                      value.toLocaleString(),
                      name === 'win_rate' ? 'Win Rate' :
                      name === 'avg_payment' ? 'Avg Payment % QPA' : 'Total Cases'
                    ]}
                  />
                  <Legend />
                  <Bar dataKey="win_rate" fill="#3b82f6" name="Provider Win Rate %" />
                  <Bar dataKey="avg_payment" fill="#f59e0b" name="Avg Payment % QPA" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Key Insights */}
        <Card>
          <CardHeader>
            <CardTitle>Air Ambulance Key Insights</CardTitle>
            <CardDescription>Critical findings from CMS PUF air ambulance data analysis</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  <span className="font-semibold text-blue-800">Higher Win Rates</span>
                </div>
                <p className="text-sm text-blue-700">
                  Air ambulance services show {((comparisonData[0]?.win_rate - comparisonData[1]?.win_rate) || 0).toFixed(1)}% 
                  higher provider win rates than standard services
                </p>
              </div>

              <div className="p-4 bg-orange-50 rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <DollarSign className="h-5 w-5 text-orange-600" />
                  <span className="font-semibold text-orange-800">Premium Payments</span>
                </div>
                <p className="text-sm text-orange-700">
                  Air ambulance payments average {((comparisonData[0]?.avg_payment - comparisonData[1]?.avg_payment) || 0).toFixed(1)}% 
                  higher than standard services
                </p>
              </div>

              <div className="p-4 bg-purple-50 rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <BarChart3 className="h-5 w-5 text-purple-600" />
                  <span className="font-semibold text-purple-800">Market Share</span>
                </div>
                <p className="text-sm text-purple-700">
                  Air ambulance represents {((comparisonData[0]?.total_cases / (comparisonData[0]?.total_cases + comparisonData[1]?.total_cases)) * 100 || 0).toFixed(1)}% 
                  of total IDR cases
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderBundledAnalysis = () => {
    const performanceData = Object.entries(dashboardData.bundled_analysis.performance_comparison || {})
      .map(([type, data]) => ({
        type: type.charAt(0).toUpperCase() + type.slice(1),
        win_rate: data.provider_win_rate * 100,
        avg_payment: data.avg_payment_pct_qpa,
        total_cases: data.total_cases,
        avg_resolution_days: data.avg_resolution_days || 0
      }));

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Package className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Bundled Dispute Analysis</h1>
          </div>
          <Badge variant="outline">Multi-Tab PUF Analysis</Badge>
        </div>

        {/* Dispute Type Performance Comparison */}
        <Card>
          <CardHeader>
            <CardTitle>Dispute Type Performance Comparison</CardTitle>
            <CardDescription>Comparing single, bundled, and batched dispute outcomes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80 mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" />
                  <YAxis />
                  <Tooltip 
                    formatter={(value, name) => [
                      name === 'win_rate' ? `${value.toFixed(1)}%` : 
                      name === 'avg_payment' ? `${value.toFixed(1)}%` :
                      name === 'avg_resolution_days' ? `${value.toFixed(1)} days` :
                      value.toLocaleString(),
                      name === 'win_rate' ? 'Win Rate' :
                      name === 'avg_payment' ? 'Avg Payment % QPA' :
                      name === 'avg_resolution_days' ? 'Avg Resolution Days' : 'Total Cases'
                    ]}
                  />
                  <Legend />
                  <Bar dataKey="win_rate" fill="#10b981" name="Provider Win Rate %" />
                  <Bar dataKey="avg_payment" fill="#f59e0b" name="Avg Payment % QPA" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {performanceData.map((item) => (
                <div key={item.type} className="p-4 border rounded-lg">
                  <h3 className="font-semibold mb-3">{item.type} Disputes</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">Win Rate</span>
                      <span className="font-bold">{item.win_rate.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Avg Payment</span>
                      <span className="font-bold">{item.avg_payment.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Total Cases</span>
                      <span className="font-bold">{formatNumber(item.total_cases)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Bundling Efficiency Metrics */}
        <Card>
          <CardHeader>
            <CardTitle>Bundling Efficiency Analysis</CardTitle>
            <CardDescription>Effectiveness and optimization insights for bundled disputes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {dashboardData.bundled_analysis.bundling_efficiency?.avg_lines_per_bundled_dispute?.toFixed(1) || 0}
                </div>
                <div className="text-sm text-blue-700">Avg Lines per Bundle</div>
              </div>
              
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {formatPercentage(dashboardData.bundled_analysis.bundling_efficiency?.bundling_rate || 0)}
                </div>
                <div className="text-sm text-green-700">Bundling Rate</div>
              </div>
              
              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">
                  {formatPercentage(dashboardData.bundled_analysis.bundling_efficiency?.efficiency_score || 0)}
                </div>
                <div className="text-sm text-purple-700">Efficiency Score</div>
              </div>
              
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">
                  {dashboardData.bundled_analysis.recommendations?.length || 0}
                </div>
                <div className="text-sm text-orange-700">Recommendations</div>
              </div>
            </div>

            {/* Recommendations */}
            <div className="space-y-3">
              <h4 className="font-semibold">Optimization Recommendations</h4>
              {dashboardData.bundled_analysis.recommendations?.map((rec, index) => (
                <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                  <span className="text-sm">{rec}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading CMS PUF Enhanced Analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="geographic">Geographic</TabsTrigger>
          <TabsTrigger value="air-ambulance">Air Ambulance</TabsTrigger>
          <TabsTrigger value="bundled">Bundled Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {renderOverview()}
        </TabsContent>

        <TabsContent value="geographic">
          {renderGeographicAnalysis()}
        </TabsContent>

        <TabsContent value="air-ambulance">
          {renderAirAmbulanceAnalysis()}
        </TabsContent>

        <TabsContent value="bundled">
          {renderBundledAnalysis()}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PUFEnhancedDashboard;
