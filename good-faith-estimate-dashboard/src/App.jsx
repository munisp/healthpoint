import { useState, useEffect } from 'react';
import { 
  FileText, 
  DollarSign, 
  Calendar, 
  Users, 
  Building, 
  Stethoscope, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  Mail, 
  Search, 
  Filter, 
  Plus, 
  Download, 
  Eye, 
  Edit, 
  Trash2, 
  Send, 
  TrendingUp, 
  Activity, 
  Shield, 
  BarChart3, 
  PieChart as RechartsPieChart, 
  RefreshCw
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
  Pie,
  Cell
} from 'recharts';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { ScrollArea } from '@/components/ui/scroll-area.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import './App.css';

export default function GoodFaithEstimateDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedGFE, setSelectedGFE] = useState(null);

  // Mock data for Good Faith Estimates
  const [gfeData, setGfeData] = useState({
    overview: {
      totalGFEs: 1247,
      pendingGFEs: 89,
      deliveredGFEs: 1158,
      averageEstimateAmount: 8500.00,
      accuracyRate: 92.5,
      totalEstimatedValue: 10599500.00
    },
    gfeList: [
      {
        id: 'GFE-2024-001',
        patientId: 'PAT-789456',
        patientName: 'Sarah Johnson',
        provider: 'Metro General Hospital',
        service: 'Knee Replacement Surgery',
        estimatedAmount: 15500.00,
        actualAmount: 15800.00,
        status: 'Delivered',
        deliveryDate: '2024-10-05',
        serviceDate: '2024-11-15',
        deliveryMethod: 'Patient Portal',
        items: [
          { description: 'Hospital Fees', amount: 8500.00 },
          { description: 'Surgeon Fees', amount: 4500.00 },
          { description: 'Anesthesia Fees', amount: 1500.00 },
          { description: 'Implants/Prosthetics', amount: 1000.00 }
        ]
      },
      {
        id: 'GFE-2024-002',
        patientId: 'PAT-789457',
        patientName: 'Robert Martinez',
        provider: 'City Surgical Center',
        service: 'Gallbladder Removal',
        estimatedAmount: 8750.00,
        actualAmount: null,
        status: 'Pending',
        deliveryDate: null,
        serviceDate: '2024-11-20',
        deliveryMethod: null,
        items: [
          { description: 'Facility Fees', amount: 4500.00 },
          { description: 'Surgeon Fees', amount: 3000.00 },
          { description: 'Anesthesia Fees', amount: 1250.00 }
        ]
      },
      {
        id: 'GFE-2024-003',
        patientId: 'PAT-789458',
        patientName: 'Emily Davis',
        provider: 'Regional Medical Center',
        service: 'Maternity Care (Vaginal Delivery)',
        estimatedAmount: 12500.00,
        actualAmount: 11800.00,
        status: 'Completed',
        deliveryDate: '2024-09-15',
        serviceDate: '2024-10-10',
        deliveryMethod: 'Email',
        items: [
          { description: 'Hospital Stay', amount: 6000.00 },
          { description: 'Physician Fees', amount: 4000.00 },
          { description: 'Newborn Care', amount: 1500.00 },
          { description: 'Epidural (Optional)', amount: 1000.00 }
        ]
      }
    ],
    analytics: {
      gfeStatus: [
        { status: 'Pending', count: 89, color: '#f59e0b' },
        { status: 'Delivered', count: 456, color: '#3b82f6' },
        { status: 'Completed', count: 702, color: '#10b981' },
        { status: 'Expired', count: 12, color: '#6b7280' }
      ],
      accuracyTrend: [
        { month: 'Jan', rate: 91.2 },
        { month: 'Feb', rate: 92.8 },
        { month: 'Mar', rate: 90.5 },
        { month: 'Apr', rate: 93.1 },
        { month: 'May', rate: 92.7 },
        { month: 'Jun', rate: 92.5 }
      ],
      deliveryMethods: [
        { method: 'Patient Portal', count: 678, color: '#3b82f6' },
        { method: 'Email', count: 345, color: '#10b981' },
        { method: 'Mail', count: 123, color: '#f59e0b' },
        { method: 'In Person', count: 12, color: '#8b5cf6' }
      ]
    }
  });

  const getStatusBadge = (status) => {
    const statusConfig = {
      'Pending': { color: 'bg-yellow-100 text-yellow-800' },
      'Delivered': { color: 'bg-blue-100 text-blue-800' },
      'Completed': { color: 'bg-green-100 text-green-800' },
      'Expired': { color: 'bg-gray-100 text-gray-800' }
    };
    
    const config = statusConfig[status] || { color: 'bg-gray-100 text-gray-800' };
    return <Badge className={config.color}>{status}</Badge>;
  };

  const getAccuracyColor = (accuracy) => {
    if (accuracy >= 95) return 'text-green-600';
    if (accuracy >= 90) return 'text-yellow-600';
    return 'text-red-600';
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total GFEs Generated</CardTitle>
            <FileText className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{gfeData.overview.totalGFEs.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +15% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending GFEs</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{gfeData.overview.pendingGFEs}</div>
            <p className="text-xs text-muted-foreground">
              Awaiting generation or delivery
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Estimate Accuracy</CardTitle>
            <Shield className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getAccuracyColor(gfeData.overview.accuracyRate)}`}>
              {gfeData.overview.accuracyRate}%
            </div>
            <p className="text-xs text-muted-foreground">
              Compared to actual charges
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Estimated Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${gfeData.overview.totalEstimatedValue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Value of all generated GFEs
            </p>
          </CardContent>
        </Card>
      </div>

      {/* GFE Status and Accuracy Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>GFE Status Distribution</CardTitle>
            <CardDescription>Current status of all generated GFEs</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={gfeData.analytics.gfeStatus}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="count"
                  nameKey="status"
                  label
                >
                  {gfeData.analytics.gfeStatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estimate Accuracy Trend</CardTitle>
            <CardDescription>Monthly accuracy of estimates vs actuals</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={gfeData.analytics.accuracyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis domain={[85, 100]} />
                <Tooltip formatter={(value) => [`${value}%`, 'Accuracy Rate']} />
                <Line type="monotone" dataKey="rate" stroke="#10b981" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Delivery Methods */}
      <Card>
        <CardHeader>
          <CardTitle>GFE Delivery Methods</CardTitle>
          <CardDescription>Distribution of GFE delivery channels</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={gfeData.analytics.deliveryMethods} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="method" type="category" width={100} />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" name="Count" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );

  const renderGFEManagement = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Good Faith Estimate Management</h2>
        <div className="flex items-center space-x-2">
          <Input placeholder="Search GFEs..." className="max-w-sm" />
          <Select>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New GFE
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {gfeData.gfeList.map((gfe) => (
          <Card key={gfe.id} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setSelectedGFE(gfe)}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <FileText className="h-5 w-5 text-blue-500" />
                    <h3 className="text-lg font-semibold">{gfe.id}</h3>
                  </div>
                  {getStatusBadge(gfe.status)}
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Estimated Amount</p>
                  <p className="text-lg font-bold text-green-600">${gfe.estimatedAmount.toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">Patient</p>
                  <p className="font-medium">{gfe.patientName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Provider</p>
                  <p className="font-medium">{gfe.provider}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Service</p>
                  <p className="font-medium">{gfe.service}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Service Date</p>
                  <p className="font-medium">{gfe.serviceDate}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Delivery Date</p>
                  <p className="font-medium">{gfe.deliveryDate || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Delivery Method</p>
                  <p className="font-medium">{gfe.deliveryMethod || 'N/A'}</p>
                </div>
              </div>

              {gfe.actualAmount && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Actual Amount:</span>
                    <span className={`text-lg font-bold ${Math.abs(gfe.actualAmount - gfe.estimatedAmount) > 400 ? 'text-red-600' : 'text-green-600'}`}>
                      ${gfe.actualAmount.toLocaleString()}
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

  const renderGFEDetails = () => {
    if (!selectedGFE) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <div className="text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Select a GFE to view details</p>
          </div>
        </div>
      );
    }

    const accuracy = selectedGFE.actualAmount ? 
      (1 - Math.abs(selectedGFE.actualAmount - selectedGFE.estimatedAmount) / selectedGFE.estimatedAmount) * 100 : null;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="outline" onClick={() => setSelectedGFE(null)}>
              ← Back to List
            </Button>
            <h2 className="text-2xl font-bold">{selectedGFE.id}</h2>
            {getStatusBadge(selectedGFE.status)}
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
            <Button>
              <Send className="mr-2 h-4 w-4" />
              Send to Patient
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* GFE Information */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Good Faith Estimate Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Patient</p>
                    <p className="font-medium">{selectedGFE.patientName} ({selectedGFE.patientId})</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Provider</p>
                    <p className="font-medium">{selectedGFE.provider}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Primary Service</p>
                    <p className="font-medium">{selectedGFE.service}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Scheduled Service Date</p>
                    <p className="font-medium">{selectedGFE.serviceDate}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Itemized Estimate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {selectedGFE.items.map((item, index) => (
                    <div key={index} className="flex items-center justify-between p-2 border rounded">
                      <span className="text-sm">{item.description}</span>
                      <span className="font-medium">${item.amount.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between p-2 border-t-2 border-gray-300 font-bold">
                    <span className="text-lg">Total Estimated Amount</span>
                    <span className="text-lg text-green-600">${selectedGFE.estimatedAmount.toLocaleString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {selectedGFE.actualAmount && (
              <Card>
                <CardHeader>
                  <CardTitle>Actual Charges Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <p className="text-sm text-muted-foreground">Actual Amount</p>
                      <p className="text-2xl font-bold">${selectedGFE.actualAmount.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Variance</p>
                      <p className={`text-2xl font-bold ${Math.abs(selectedGFE.actualAmount - selectedGFE.estimatedAmount) > 400 ? 'text-red-600' : 'text-green-600'}`}>
                        ${(selectedGFE.actualAmount - selectedGFE.estimatedAmount).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Status & Delivery</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  {getStatusBadge(selectedGFE.status)}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Delivery Method</p>
                  <p className="font-medium">{selectedGFE.deliveryMethod || 'Not Delivered'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Delivery Date</p>
                  <p className="font-medium">{selectedGFE.deliveryDate || 'N/A'}</p>
                </div>
              </CardContent>
            </Card>

            {accuracy !== null && (
              <Card>
                <CardHeader>
                  <CardTitle>Accuracy</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                  <div className={`text-4xl font-bold ${getAccuracyColor(accuracy)}`}>
                    {accuracy.toFixed(1)}%
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">Estimate vs Actual</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button className="w-full" variant="outline">
                  <Edit className="mr-2 h-4 w-4" />
                  Edit GFE
                </Button>
                <Button className="w-full" variant="outline">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Generate New Version
                </Button>
                <Button className="w-full" variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Void GFE
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
        <h2 className="text-2xl font-bold">GFE Analytics</h2>
        <div className="flex items-center space-x-2">
          <Select>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Time Period" />
            </SelectTrigger>
            <SelectContent>
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

      {/* Detailed Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Accuracy by Service Type</CardTitle>
            <CardDescription>Estimate accuracy across different services</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Placeholder for chart */}
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              <BarChart3 className="h-12 w-12 opacity-50" />
              <p className="ml-4">Accuracy by Service Type Chart</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeliness of Delivery</CardTitle>
            <CardDescription>Days from request to GFE delivery</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Placeholder for chart */}
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              <Clock className="h-12 w-12 opacity-50" />
              <p className="ml-4">Delivery Timeliness Chart</p>
            </div>
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
            <FileText className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Good Faith Estimate Dashboard</h1>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Create GFE
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="management">GFE Management</TabsTrigger>
            <TabsTrigger value="details">GFE Details</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6">
            {renderOverview()}
          </TabsContent>
          <TabsContent value="management" className="mt-6">
            {renderGFEManagement()}
          </TabsContent>
          <TabsContent value="details" className="mt-6">
            {renderGFEDetails()}
          </TabsContent>
          <TabsContent value="analytics" className="mt-6">
            {renderAnalytics()}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
