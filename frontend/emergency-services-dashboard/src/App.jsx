import { useState, useEffect } from 'react';
import { 
  Zap, 
  AlertTriangle, 
  Clock, 
  MapPin, 
  Stethoscope, 
  Ambulance, 
  Heart, 
  Shield, 
  DollarSign, 
  CheckCircle, 
  XCircle, 
  Activity, 
  TrendingUp, 
  TrendingDown,
  Users, 
  Building, 
  FileText, 
  Search, 
  Filter, 
  RefreshCw, 
  Download, 
  Eye, 
  Phone, 
  Navigation,
  Timer,
  AlertCircle,
  Target,
  BarChart3
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
  PieChart,
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

export default function EmergencyServicesDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedCase, setSelectedCase] = useState(null);

  // Mock data for Emergency Services
  const [emergencyData, setEmergencyData] = useState({
    overview: {
      totalEmergencyClaims: 2847,
      nsaProtectedClaims: 2654,
      averageProcessingTime: 18,
      complianceRate: 98.7,
      totalEmergencyAmount: 8947392.50,
      outOfNetworkClaims: 1247,
      balanceBillingPrevented: 2156
    },
    emergencyCases: [
      {
        id: 'ER-2024-001',
        patientId: 'PAT-789456',
        patientName: 'Sarah Johnson',
        facility: 'Metro General Hospital',
        emergencyType: 'Cardiac Emergency',
        arrivalTime: '2024-10-08 14:30',
        treatmentTime: '2024-10-08 14:45',
        dischargeTime: '2024-10-08 18:20',
        severity: 'Critical',
        nsaStatus: 'Protected',
        networkStatus: 'Out-of-Network',
        originalAmount: 45000.00,
        nsaAmount: 12500.00,
        patientResponsibility: 2500.00,
        insurancePayer: 'Blue Cross Blue Shield',
        services: ['Emergency Room', 'Cardiac Catheterization', 'ICU Stay'],
        physicians: ['Dr. Michael Chen - Cardiologist', 'Dr. Sarah Wilson - Emergency Medicine'],
        complianceStatus: 'Fully Compliant',
        balanceBillingPrevented: true
      },
      {
        id: 'ER-2024-002',
        patientId: 'PAT-789457',
        patientName: 'Robert Martinez',
        facility: 'City Emergency Center',
        emergencyType: 'Trauma - Motor Vehicle Accident',
        arrivalTime: '2024-10-08 09:15',
        treatmentTime: '2024-10-08 09:20',
        dischargeTime: '2024-10-08 16:45',
        severity: 'Severe',
        nsaStatus: 'Protected',
        networkStatus: 'In-Network',
        originalAmount: 28500.00,
        nsaAmount: 28500.00,
        patientResponsibility: 1500.00,
        insurancePayer: 'Aetna',
        services: ['Emergency Room', 'Surgery', 'Radiology'],
        physicians: ['Dr. Lisa Rodriguez - Trauma Surgery', 'Dr. James Kim - Emergency Medicine'],
        complianceStatus: 'Fully Compliant',
        balanceBillingPrevented: false
      },
      {
        id: 'ER-2024-003',
        patientId: 'PAT-789458',
        patientName: 'Emily Davis',
        facility: 'Regional Medical Center',
        emergencyType: 'Severe Allergic Reaction',
        arrivalTime: '2024-10-07 22:10',
        treatmentTime: '2024-10-07 22:15',
        dischargeTime: '2024-10-08 02:30',
        severity: 'Moderate',
        nsaStatus: 'Protected',
        networkStatus: 'Out-of-Network',
        originalAmount: 8500.00,
        nsaAmount: 6200.00,
        patientResponsibility: 500.00,
        insurancePayer: 'United Healthcare',
        services: ['Emergency Room', 'Allergy Treatment', 'Observation'],
        physicians: ['Dr. Amanda Foster - Emergency Medicine'],
        complianceStatus: 'Fully Compliant',
        balanceBillingPrevented: true
      }
    ],
    facilityPerformance: [
      { facility: 'Metro General Hospital', cases: 456, compliance: 99.1, avgTime: 16 },
      { facility: 'City Emergency Center', cases: 389, compliance: 98.7, avgTime: 14 },
      { facility: 'Regional Medical Center', cases: 334, compliance: 97.9, avgTime: 19 },
      { facility: 'University Hospital', cases: 298, compliance: 99.3, avgTime: 15 },
      { facility: 'Community Medical', cases: 267, compliance: 96.8, avgTime: 22 }
    ],
    emergencyTypes: [
      { type: 'Cardiac Emergency', count: 456, protected: 445, color: '#ef4444' },
      { type: 'Trauma', count: 389, protected: 378, color: '#f59e0b' },
      { type: 'Stroke', count: 334, protected: 329, color: '#8b5cf6' },
      { type: 'Respiratory Emergency', count: 298, protected: 291, color: '#3b82f6' },
      { type: 'Allergic Reaction', count: 267, protected: 262, color: '#10b981' },
      { type: 'Other', count: 1103, protected: 1049, color: '#6b7280' }
    ],
    trends: {
      monthlyVolume: [
        { month: 'Jan', total: 234, protected: 228, outOfNetwork: 89 },
        { month: 'Feb', total: 198, protected: 194, outOfNetwork: 76 },
        { month: 'Mar', total: 267, protected: 261, outOfNetwork: 102 },
        { month: 'Apr', total: 245, protected: 241, outOfNetwork: 94 },
        { month: 'May', total: 289, protected: 284, outOfNetwork: 112 },
        { month: 'Jun', total: 312, protected: 307, outOfNetwork: 125 }
      ],
      complianceRate: [
        { month: 'Jan', rate: 97.8 },
        { month: 'Feb', rate: 98.2 },
        { month: 'Mar', rate: 97.1 },
        { month: 'Apr', rate: 98.9 },
        { month: 'May', rate: 98.6 },
        { month: 'Jun', rate: 98.7 }
      ],
      costSavings: [
        { month: 'Jan', prevented: 145000, savings: 89000 },
        { month: 'Feb', prevented: 123000, savings: 76000 },
        { month: 'Mar', prevented: 178000, savings: 112000 },
        { month: 'Apr', prevented: 156000, savings: 98000 },
        { month: 'May', prevented: 189000, savings: 118000 },
        { month: 'Jun', prevented: 201000, savings: 127000 }
      ]
    }
  });

  const getSeverityBadge = (severity) => {
    const severityConfig = {
      'Critical': { color: 'bg-red-100 text-red-800' },
      'Severe': { color: 'bg-orange-100 text-orange-800' },
      'Moderate': { color: 'bg-yellow-100 text-yellow-800' },
      'Mild': { color: 'bg-green-100 text-green-800' }
    };
    
    const config = severityConfig[severity] || { color: 'bg-gray-100 text-gray-800' };
    return <Badge className={config.color}>{severity}</Badge>;
  };

  const getNetworkStatusBadge = (status) => {
    const statusConfig = {
      'In-Network': { color: 'bg-green-100 text-green-800' },
      'Out-of-Network': { color: 'bg-red-100 text-red-800' },
      'Emergency Exception': { color: 'bg-blue-100 text-blue-800' }
    };
    
    const config = statusConfig[status] || { color: 'bg-gray-100 text-gray-800' };
    return <Badge className={config.color}>{status}</Badge>;
  };

  const getNSAStatusBadge = (status) => {
    const statusConfig = {
      'Protected': { color: 'bg-green-100 text-green-800' },
      'Not Protected': { color: 'bg-red-100 text-red-800' },
      'Under Review': { color: 'bg-yellow-100 text-yellow-800' }
    };
    
    const config = statusConfig[status] || { color: 'bg-gray-100 text-gray-800' };
    return <Badge className={config.color}>{status}</Badge>;
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Emergency Claims</CardTitle>
            <Zap className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{emergencyData.overview.totalEmergencyClaims.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +8.2% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">NSA Protected</CardTitle>
            <Shield className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{emergencyData.overview.nsaProtectedClaims.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {((emergencyData.overview.nsaProtectedClaims / emergencyData.overview.totalEmergencyClaims) * 100).toFixed(1)}% protection rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Processing Time</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{emergencyData.overview.averageProcessingTime} min</div>
            <p className="text-xs text-muted-foreground">
              <TrendingDown className="inline h-3 w-3 mr-1" />
              -2.1 min from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Compliance Rate</CardTitle>
            <Target className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{emergencyData.overview.complianceRate}%</div>
            <p className="text-xs text-muted-foreground">
              NSA compliance maintained
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Emergency Volume and Compliance Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Emergency Volume Trends</CardTitle>
            <CardDescription>Monthly emergency claims and NSA protection</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={emergencyData.trends.monthlyVolume}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="total" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} name="Total Claims" />
                <Area type="monotone" dataKey="protected" stackId="2" stroke="#10b981" fill="#10b981" fillOpacity={0.6} name="NSA Protected" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>NSA Compliance Rate</CardTitle>
            <CardDescription>Monthly compliance with NSA requirements</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={emergencyData.trends.complianceRate}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis domain={[95, 100]} />
                <Tooltip formatter={(value) => [`${value}%`, 'Compliance Rate']} />
                <Line type="monotone" dataKey="rate" stroke="#10b981" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Emergency Types Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Emergency Types Distribution</CardTitle>
            <CardDescription>Claims by emergency type and NSA protection</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={emergencyData.emergencyTypes}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="count"
                  nameKey="type"
                  label
                >
                  {emergencyData.emergencyTypes.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost Savings from NSA Protection</CardTitle>
            <CardDescription>Monthly balance billing prevention savings</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={emergencyData.trends.costSavings}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, '']} />
                <Bar dataKey="prevented" fill="#ef4444" name="Balance Billing Prevented" />
                <Bar dataKey="savings" fill="#10b981" name="Patient Savings" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Facility Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Emergency Facility Performance</CardTitle>
          <CardDescription>NSA compliance and processing efficiency by facility</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {emergencyData.facilityPerformance.map((facility, index) => (
              <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <Building className="h-5 w-5 text-blue-500" />
                  <div>
                    <p className="font-medium">{facility.facility}</p>
                    <p className="text-sm text-muted-foreground">{facility.cases} emergency cases</p>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">Compliance</p>
                    <p className={`font-bold ${facility.compliance >= 98 ? 'text-green-600' : facility.compliance >= 95 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {facility.compliance}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">Avg Time</p>
                    <p className="font-bold">{facility.avgTime} min</p>
                  </div>
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderCaseManagement = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Emergency Case Management</h2>
        <div className="flex items-center space-x-2">
          <Input placeholder="Search cases..." className="max-w-sm" />
          <Select>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="severe">Severe</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="mild">Mild</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {emergencyData.emergencyCases.map((emergencyCase) => (
          <Card key={emergencyCase.id} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setSelectedCase(emergencyCase)}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <Zap className="h-5 w-5 text-orange-500" />
                    <h3 className="text-lg font-semibold">{emergencyCase.id}</h3>
                  </div>
                  {getSeverityBadge(emergencyCase.severity)}
                  {getNSAStatusBadge(emergencyCase.nsaStatus)}
                  {getNetworkStatusBadge(emergencyCase.networkStatus)}
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">NSA Amount</p>
                  <p className="text-lg font-bold text-green-600">${emergencyCase.nsaAmount.toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">Patient</p>
                  <p className="font-medium">{emergencyCase.patientName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Facility</p>
                  <p className="font-medium">{emergencyCase.facility}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Emergency Type</p>
                  <p className="font-medium">{emergencyCase.emergencyType}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm mb-4">
                <div>
                  <p className="text-muted-foreground">Arrival Time</p>
                  <p className="font-medium">{emergencyCase.arrivalTime}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Treatment Started</p>
                  <p className="font-medium">{emergencyCase.treatmentTime}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Discharge Time</p>
                  <p className="font-medium">{emergencyCase.dischargeTime || 'In Progress'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Insurance</p>
                  <p className="font-medium">{emergencyCase.insurancePayer}</p>
                </div>
              </div>

              {emergencyCase.balanceBillingPrevented && (
                <div className="bg-green-50 p-3 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Shield className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800">
                      Balance billing prevented - Patient saved ${(emergencyCase.originalAmount - emergencyCase.nsaAmount).toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderCaseDetails = () => {
    if (!selectedCase) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <div className="text-center">
            <Stethoscope className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Select an emergency case to view details</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="outline" onClick={() => setSelectedCase(null)}>
              ← Back to Cases
            </Button>
            <h2 className="text-2xl font-bold">{selectedCase.id}</h2>
            {getSeverityBadge(selectedCase.severity)}
            {getNSAStatusBadge(selectedCase.nsaStatus)}
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Export Case
            </Button>
            <Button>
              <Phone className="mr-2 h-4 w-4" />
              Contact Facility
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Case Information */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Emergency Case Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Patient ID</p>
                    <p className="font-medium">{selectedCase.patientId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Patient Name</p>
                    <p className="font-medium">{selectedCase.patientName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Facility</p>
                    <p className="font-medium">{selectedCase.facility}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Emergency Type</p>
                    <p className="font-medium">{selectedCase.emergencyType}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Network Status</p>
                    {getNetworkStatusBadge(selectedCase.networkStatus)}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Insurance Payer</p>
                    <p className="font-medium">{selectedCase.insurancePayer}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Timeline & Treatment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center p-4 border rounded-lg">
                    <Clock className="h-6 w-6 mx-auto mb-2 text-blue-500" />
                    <p className="text-sm text-muted-foreground">Arrival</p>
                    <p className="font-medium">{selectedCase.arrivalTime}</p>
                  </div>
                  <div className="text-center p-4 border rounded-lg">
                    <Activity className="h-6 w-6 mx-auto mb-2 text-green-500" />
                    <p className="text-sm text-muted-foreground">Treatment Started</p>
                    <p className="font-medium">{selectedCase.treatmentTime}</p>
                  </div>
                  <div className="text-center p-4 border rounded-lg">
                    <CheckCircle className="h-6 w-6 mx-auto mb-2 text-purple-500" />
                    <p className="text-sm text-muted-foreground">Discharge</p>
                    <p className="font-medium">{selectedCase.dischargeTime || 'In Progress'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Services Provided</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {selectedCase.services.map((service, index) => (
                    <div key={index} className="flex items-center space-x-2 p-2 border rounded">
                      <Stethoscope className="h-4 w-4 text-blue-500" />
                      <span>{service}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Attending Physicians</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {selectedCase.physicians.map((physician, index) => (
                    <div key={index} className="flex items-center space-x-2 p-2 border rounded">
                      <Users className="h-4 w-4 text-green-500" />
                      <span>{physician}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Financial Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Original Amount</p>
                  <p className="text-xl font-bold text-red-600">${selectedCase.originalAmount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">NSA Protected Amount</p>
                  <p className="text-xl font-bold text-green-600">${selectedCase.nsaAmount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Patient Responsibility</p>
                  <p className="text-lg font-bold text-blue-600">${selectedCase.patientResponsibility.toLocaleString()}</p>
                </div>
                {selectedCase.balanceBillingPrevented && (
                  <div className="pt-4 border-t bg-green-50 p-3 rounded">
                    <p className="text-sm font-medium text-green-800">Patient Savings</p>
                    <p className="text-lg font-bold text-green-600">
                      ${(selectedCase.originalAmount - selectedCase.nsaAmount).toLocaleString()}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>NSA Compliance Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Compliance Status</p>
                  <Badge className="bg-green-100 text-green-800 mt-1">{selectedCase.complianceStatus}</Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Protection Applied</p>
                  <div className="flex items-center space-x-2 mt-1">
                    <Shield className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium">NSA Emergency Protection</span>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Balance Billing</p>
                  <div className="flex items-center space-x-2 mt-1">
                    {selectedCase.balanceBillingPrevented ? (
                      <>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        <span className="text-sm font-medium text-green-600">Prevented</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-gray-500" />
                        <span className="text-sm font-medium text-gray-600">Not Applicable</span>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button className="w-full" variant="outline">
                  <FileText className="mr-2 h-4 w-4" />
                  View Medical Records
                </Button>
                <Button className="w-full" variant="outline">
                  <DollarSign className="mr-2 h-4 w-4" />
                  Billing Details
                </Button>
                <Button className="w-full" variant="outline">
                  <Phone className="mr-2 h-4 w-4" />
                  Contact Patient
                </Button>
                <Button className="w-full" variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  Export Case File
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  };

  const renderAnalytics = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Emergency Services Analytics</h2>
        <div className="flex items-center space-x-2">
          <Select>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Time Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
              <SelectItem value="1y">Last Year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export Analytics
          </Button>
        </div>
      </div>

      {/* Key Performance Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Emergency Amount</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${emergencyData.overview.totalEmergencyAmount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Total emergency services value
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out-of-Network Claims</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{emergencyData.overview.outOfNetworkClaims.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {((emergencyData.overview.outOfNetworkClaims / emergencyData.overview.totalEmergencyClaims) * 100).toFixed(1)}% of total claims
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Balance Billing Prevented</CardTitle>
            <Shield className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{emergencyData.overview.balanceBillingPrevented.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Patient protection instances
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Case Value</CardTitle>
            <BarChart3 className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${(emergencyData.overview.totalEmergencyAmount / emergencyData.overview.totalEmergencyClaims).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Per emergency case
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Emergency Types by Volume</CardTitle>
            <CardDescription>Claims distribution by emergency type</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={emergencyData.emergencyTypes} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="type" type="category" width={120} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" name="Total Claims" />
                <Bar dataKey="protected" fill="#10b981" name="NSA Protected" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly Cost Impact</CardTitle>
            <CardDescription>Balance billing prevention and patient savings</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={emergencyData.trends.costSavings}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, '']} />
                <Area type="monotone" dataKey="prevented" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.6} name="Billing Prevented" />
                <Area type="monotone" dataKey="savings" stackId="2" stroke="#10b981" fill="#10b981" fillOpacity={0.6} name="Patient Savings" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <Zap className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Emergency Services Dashboard</h1>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm">
              <Ambulance className="mr-2 h-4 w-4" />
              Emergency Alert
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="cases">Case Management</TabsTrigger>
            <TabsTrigger value="details">Case Details</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6">
            {renderOverview()}
          </TabsContent>
          <TabsContent value="cases" className="mt-6">
            {renderCaseManagement()}
          </TabsContent>
          <TabsContent value="details" className="mt-6">
            {renderCaseDetails()}
          </TabsContent>
          <TabsContent value="analytics" className="mt-6">
            {renderAnalytics()}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
