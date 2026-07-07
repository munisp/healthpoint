import { useState, useEffect } from 'react';
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  FileText, 
  DollarSign, 
  Clock, 
  TrendingUp, 
  TrendingDown,
  Building, 
  Users, 
  Activity, 
  Eye, 
  Search, 
  Filter, 
  Download, 
  RefreshCw,
  Bell,
  Zap,
  Target,
  BarChart3,
  PieChart,
  Calendar,
  MapPin,
  AlertCircle
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  AreaChart,
  Area
} from 'recharts';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { ScrollArea } from '@/components/ui/scroll-area.jsx';
import './App.css';

export default function NSAComplianceDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedViolation, setSelectedViolation] = useState(null);

  // Mock data for NSA Compliance
  const [complianceData, setComplianceData] = useState({
    overview: {
      overallComplianceScore: 94.2,
      totalClaims: 45678,
      protectedClaims: 3421,
      violationAlerts: 12,
      goodFaithEstimates: 8934,
      emergencyServices: 1247,
      outOfNetworkClaims: 2156
    },
    violations: [
      {
        id: 'NSA-VIO-001',
        type: 'Balance Billing',
        severity: 'High',
        provider: 'Metro General Hospital',
        patient: 'Sarah Johnson',
        claimId: 'CLM-456789',
        amount: 8500.00,
        violationDate: '2024-10-05',
        status: 'Under Review',
        description: 'Provider attempted to balance bill patient for emergency services',
        correctionRequired: 'Remove balance billing charges',
        dueDate: '2024-10-15'
      },
      {
        id: 'NSA-VIO-002',
        type: 'Missing GFE',
        severity: 'Medium',
        provider: 'City Surgical Center',
        patient: 'Michael Chen',
        claimId: 'CLM-456790',
        amount: 12000.00,
        violationDate: '2024-10-03',
        status: 'Corrected',
        description: 'Good faith estimate not provided for scheduled surgery',
        correctionRequired: 'Provide retroactive GFE and patient notification',
        dueDate: '2024-10-13',
        correctionDate: '2024-10-08'
      },
      {
        id: 'NSA-VIO-003',
        type: 'Network Adequacy',
        severity: 'Low',
        provider: 'Specialty Clinic Network',
        patient: 'Multiple',
        claimId: 'Multiple',
        amount: 0,
        violationDate: '2024-10-01',
        status: 'Action Required',
        description: 'Insufficient in-network specialists in geographic area',
        correctionRequired: 'Expand network or provide out-of-network coverage',
        dueDate: '2024-11-01'
      }
    ],
    complianceMetrics: {
      balanceBillingPrevention: 98.5,
      goodFaithEstimateCompliance: 92.1,
      emergencyServicesCompliance: 99.2,
      networkAdequacy: 87.3,
      priorAuthorizationCompliance: 94.8,
      surpriseBillingProtection: 96.7
    },
    trends: {
      complianceScore: [
        { month: 'Jan', score: 91.2 },
        { month: 'Feb', score: 92.8 },
        { month: 'Mar', score: 90.5 },
        { month: 'Apr', score: 93.1 },
        { month: 'May', score: 94.7 },
        { month: 'Jun', score: 94.2 }
      ],
      violations: [
        { month: 'Jan', count: 18, resolved: 16 },
        { month: 'Feb', count: 15, resolved: 14 },
        { month: 'Mar', count: 22, resolved: 19 },
        { month: 'Apr', count: 14, resolved: 13 },
        { month: 'May', count: 11, resolved: 10 },
        { month: 'Jun', count: 12, resolved: 8 }
      ],
      protectedClaims: [
        { month: 'Jan', emergency: 198, outOfNetwork: 145, total: 343 },
        { month: 'Feb', emergency: 156, outOfNetwork: 167, total: 323 },
        { month: 'Mar', emergency: 234, outOfNetwork: 189, total: 423 },
        { month: 'Apr', emergency: 178, outOfNetwork: 156, total: 334 },
        { month: 'May', emergency: 167, outOfNetwork: 178, total: 345 },
        { month: 'Jun', emergency: 189, outOfNetwork: 198, total: 387 }
      ]
    },
    riskAssessment: [
      { category: 'High Risk', count: 23, color: '#ef4444' },
      { category: 'Medium Risk', count: 67, color: '#f59e0b' },
      { category: 'Low Risk', count: 156, color: '#10b981' },
      { category: 'Compliant', count: 3175, color: '#3b82f6' }
    ]
  });

  const getSeverityBadge = (severity) => {
    const severityConfig = {
      'High': { color: 'bg-red-100 text-red-800' },
      'Medium': { color: 'bg-yellow-100 text-yellow-800' },
      'Low': { color: 'bg-blue-100 text-blue-800' }
    };
    
    const config = severityConfig[severity] || { color: 'bg-gray-100 text-gray-800' };
    return <Badge className={config.color}>{severity}</Badge>;
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      'Under Review': { color: 'bg-yellow-100 text-yellow-800' },
      'Corrected': { color: 'bg-green-100 text-green-800' },
      'Action Required': { color: 'bg-red-100 text-red-800' },
      'Pending': { color: 'bg-blue-100 text-blue-800' }
    };
    
    const config = statusConfig[status] || { color: 'bg-gray-100 text-gray-800' };
    return <Badge className={config.color}>{status}</Badge>;
  };

  const getComplianceColor = (score) => {
    if (score >= 95) return 'text-green-600';
    if (score >= 90) return 'text-yellow-600';
    return 'text-red-600';
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Overall Compliance Score */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Overall NSA Compliance Score</h2>
              <p className="text-gray-600 mt-1">Current compliance with No Surprises Act requirements</p>
            </div>
            <div className="text-right">
              <div className={`text-4xl font-bold ${getComplianceColor(complianceData.overview.overallComplianceScore)}`}>
                {complianceData.overview.overallComplianceScore}%
              </div>
              <div className="flex items-center mt-2">
                <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
                <span className="text-sm text-green-600">+2.1% from last month</span>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Progress value={complianceData.overview.overallComplianceScore} className="h-3" />
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Protected Claims</CardTitle>
            <Shield className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{complianceData.overview.protectedClaims.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              NSA protection applied
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Violation Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{complianceData.overview.violationAlerts}</div>
            <p className="text-xs text-muted-foreground">
              Requiring immediate attention
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Good Faith Estimates</CardTitle>
            <FileText className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{complianceData.overview.goodFaithEstimates.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Generated this month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Emergency Services</CardTitle>
            <Zap className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{complianceData.overview.emergencyServices.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              NSA-compliant processing
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Compliance Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Compliance Metrics by Category</CardTitle>
            <CardDescription>Performance across NSA requirements</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(complianceData.complianceMetrics).map(([key, value]) => (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                  <span className={`text-sm font-bold ${getComplianceColor(value)}`}>
                    {value}%
                  </span>
                </div>
                <Progress value={value} className="h-2" />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risk Assessment Distribution</CardTitle>
            <CardDescription>Claims categorized by compliance risk</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <RechartsPieChart>
                <Pie
                  data={complianceData.riskAssessment}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                  nameKey="category"
                  label
                >
                  {complianceData.riskAssessment.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Compliance Score Trend</CardTitle>
            <CardDescription>Monthly compliance performance</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={complianceData.trends.complianceScore}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis domain={[85, 100]} />
                <Tooltip formatter={(value) => [`${value}%`, 'Compliance Score']} />
                <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Protected Claims Trend</CardTitle>
            <CardDescription>Monthly NSA-protected claim volume</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={complianceData.trends.protectedClaims}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="emergency" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} />
                <Area type="monotone" dataKey="outOfNetwork" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderViolations = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">NSA Violations & Alerts</h2>
        <div className="flex items-center space-x-2">
          <Input placeholder="Search violations..." className="max-w-sm" />
          <Select>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {complianceData.violations.map((violation) => (
          <Card key={violation.id} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setSelectedViolation(violation)}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className={`h-5 w-5 ${
                      violation.severity === 'High' ? 'text-red-500' :
                      violation.severity === 'Medium' ? 'text-yellow-500' : 'text-blue-500'
                    }`} />
                    <h3 className="text-lg font-semibold">{violation.id}</h3>
                  </div>
                  {getSeverityBadge(violation.severity)}
                  {getStatusBadge(violation.status)}
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Violation Type</p>
                  <p className="font-medium">{violation.type}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">Provider</p>
                  <p className="font-medium">{violation.provider}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Patient</p>
                  <p className="font-medium">{violation.patient}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Claim ID</p>
                  <p className="font-medium">{violation.claimId}</p>
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg mb-4">
                <p className="text-sm font-medium text-gray-700 mb-1">Description:</p>
                <p className="text-sm text-gray-600">{violation.description}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Violation Date</p>
                  <p className="font-medium">{violation.violationDate}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Due Date</p>
                  <p className="font-medium">{violation.dueDate}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Amount</p>
                  <p className="font-medium">
                    {violation.amount > 0 ? `$${violation.amount.toLocaleString()}` : 'N/A'}
                  </p>
                </div>
              </div>

              {violation.correctionDate && (
                <div className="mt-4 p-3 bg-green-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-green-800">Corrected on:</span>
                    <span className="text-sm font-bold text-green-600">{violation.correctionDate}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderMonitoring = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Real-Time Compliance Monitoring</h2>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm">
            <Bell className="mr-2 h-4 w-4" />
            Configure Alerts
          </Button>
        </div>
      </div>

      {/* Real-time Alerts */}
      <Card>
        <CardHeader>
          <CardTitle>Active Monitoring Alerts</CardTitle>
          <CardDescription>Real-time compliance status and alerts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg bg-red-50">
              <div className="flex items-center space-x-3">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <div>
                  <p className="font-medium text-red-800">High Priority: Balance Billing Detected</p>
                  <p className="text-sm text-red-600">Provider Metro General attempting to bill patient directly</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Badge className="bg-red-100 text-red-800">2 min ago</Badge>
                <Button size="sm" variant="outline">Review</Button>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg bg-yellow-50">
              <div className="flex items-center space-x-3">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                <div>
                  <p className="font-medium text-yellow-800">Medium Priority: Missing GFE</p>
                  <p className="text-sm text-yellow-600">Scheduled procedure without good faith estimate</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Badge className="bg-yellow-100 text-yellow-800">15 min ago</Badge>
                <Button size="sm" variant="outline">Review</Button>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg bg-green-50">
              <div className="flex items-center space-x-3">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <div>
                  <p className="font-medium text-green-800">Resolved: Network Adequacy Issue</p>
                  <p className="text-sm text-green-600">Additional in-network providers added to coverage area</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Badge className="bg-green-100 text-green-800">1 hour ago</Badge>
                <Button size="sm" variant="outline">View</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Monitoring Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Violation Trends</CardTitle>
            <CardDescription>Monthly violation detection and resolution</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={complianceData.trends.violations}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#ef4444" name="Violations Detected" />
                <Bar dataKey="resolved" fill="#10b981" name="Violations Resolved" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Performance</CardTitle>
            <CardDescription>Compliance monitoring system health</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Claims Processing Speed</span>
                <span className="text-sm font-bold text-green-600">98.5%</span>
              </div>
              <Progress value={98.5} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Alert Response Time</span>
                <span className="text-sm font-bold text-green-600">94.2%</span>
              </div>
              <Progress value={94.2} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Data Accuracy</span>
                <span className="text-sm font-bold text-green-600">99.7%</span>
              </div>
              <Progress value={99.7} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">System Uptime</span>
                <span className="text-sm font-bold text-green-600">99.9%</span>
              </div>
              <Progress value={99.9} className="h-2" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderReporting = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Compliance Reporting</h2>
        <div className="flex items-center space-x-2">
          <Select>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Report Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly Summary</SelectItem>
              <SelectItem value="quarterly">Quarterly Report</SelectItem>
              <SelectItem value="annual">Annual Compliance</SelectItem>
              <SelectItem value="regulatory">Regulatory Filing</SelectItem>
            </SelectContent>
          </Select>
          <Button>
            <Download className="mr-2 h-4 w-4" />
            Generate Report
          </Button>
        </div>
      </div>

      {/* Report Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="cursor-pointer hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3 mb-4">
              <FileText className="h-8 w-8 text-blue-500" />
              <div>
                <h3 className="font-semibold">Monthly Compliance Summary</h3>
                <p className="text-sm text-muted-foreground">Comprehensive monthly overview</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Last Generated:</span>
                <span>Oct 1, 2024</span>
              </div>
              <div className="flex justify-between">
                <span>Status:</span>
                <Badge className="bg-green-100 text-green-800">Ready</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3 mb-4">
              <BarChart3 className="h-8 w-8 text-green-500" />
              <div>
                <h3 className="font-semibold">Violation Analysis Report</h3>
                <p className="text-sm text-muted-foreground">Detailed violation trends</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Last Generated:</span>
                <span>Sep 28, 2024</span>
              </div>
              <div className="flex justify-between">
                <span>Status:</span>
                <Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-lg transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center space-x-3 mb-4">
              <Target className="h-8 w-8 text-purple-500" />
              <div>
                <h3 className="font-semibold">Regulatory Filing</h3>
                <p className="text-sm text-muted-foreground">Federal compliance report</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Due Date:</span>
                <span>Oct 31, 2024</span>
              </div>
              <div className="flex justify-between">
                <span>Status:</span>
                <Badge className="bg-blue-100 text-blue-800">In Progress</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Reports */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Reports</CardTitle>
          <CardDescription>Generated compliance reports and filings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { name: 'September 2024 Monthly Summary', date: '2024-10-01', type: 'Monthly', status: 'Completed' },
              { name: 'Q3 2024 Quarterly Report', date: '2024-09-30', type: 'Quarterly', status: 'Completed' },
              { name: 'NSA Violation Analysis - September', date: '2024-09-28', type: 'Analysis', status: 'Completed' },
              { name: 'Federal Regulatory Filing Q3', date: '2024-09-25', type: 'Regulatory', status: 'Submitted' }
            ].map((report, index) => (
              <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <FileText className="h-5 w-5 text-gray-500" />
                  <div>
                    <p className="font-medium">{report.name}</p>
                    <p className="text-sm text-muted-foreground">{report.type} • Generated {report.date}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {getStatusBadge(report.status)}
                  <Button variant="ghost" size="sm">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm">
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <Shield className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">NSA Compliance Dashboard</h1>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm">
              <Bell className="mr-2 h-4 w-4" />
              Alerts
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="violations">Violations</TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
            <TabsTrigger value="reporting">Reporting</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6">
            {renderOverview()}
          </TabsContent>
          <TabsContent value="violations" className="mt-6">
            {renderViolations()}
          </TabsContent>
          <TabsContent value="monitoring" className="mt-6">
            {renderMonitoring()}
          </TabsContent>
          <TabsContent value="reporting" className="mt-6">
            {renderReporting()}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
