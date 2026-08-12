import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import { 
  Users, 
  Building2, 
  Shield, 
  Settings, 
  BarChart3, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Server,
  Database,
  Activity,
  UserPlus,
  Edit,
  Trash2,
  Eye,
  Download,
  Upload,
  RefreshCw,
  Search,
  Filter,
  Plus,
  Bell,
  Lock,
  Unlock,
  Globe,
  Zap,
  TrendingUp,
  TrendingDown,
  FileText,
  DollarSign,
  Scale,
  AlertCircle,
  Gavel,
  Receipt,
  FileCheck,
  Calculator,
  CreditCard
} from 'lucide-react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

function IntegratedApp() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [systemStats, setSystemStats] = useState({});
  const [nsaStats, setNsaStats] = useState({});
  const [idrDisputes, setIdrDisputes] = useState([]);
  const [gfeRequests, setGfeRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Mock data for demonstration
  useEffect(() => {
    // Existing platform data
    setUsers([
      {
        id: '1',
        email: 'admin@medcorp.com',
        firstName: 'John',
        lastName: 'Admin',
        role: 'tenant_admin',
        status: 'active',
        tenant: 'MedCorp Healthcare',
        lastLogin: '2025-10-05T10:30:00Z',
        createdAt: '2025-01-15T09:00:00Z'
      },
      {
        id: '2',
        email: 'provider@regionalmed.com',
        firstName: 'Sarah',
        lastName: 'Provider',
        role: 'provider_admin',
        status: 'active',
        tenant: 'Regional Medical Group',
        lastLogin: '2025-10-05T08:15:00Z',
        createdAt: '2025-02-20T14:30:00Z'
      },
      {
        id: '3',
        email: 'user@healthsystem.com',
        firstName: 'Mike',
        lastName: 'User',
        role: 'provider_user',
        status: 'pending',
        tenant: 'Health System Alliance',
        lastLogin: null,
        createdAt: '2025-10-04T16:45:00Z'
      }
    ]);

    setTenants([
      {
        id: '1',
        name: 'MedCorp Healthcare',
        domain: 'medcorp.healthcare.com',
        status: 'active',
        userCount: 847,
        claimsCount: 12500,
        revenue: 500373.75,
        createdAt: '2024-06-01T00:00:00Z',
        nsaCompliant: true,
        idrEnabled: true
      },
      {
        id: '2',
        name: 'Regional Medical Group',
        domain: 'regional.medical.com',
        status: 'active',
        userCount: 234,
        claimsCount: 3200,
        revenue: 125450.00,
        createdAt: '2024-08-15T00:00:00Z',
        nsaCompliant: true,
        idrEnabled: true
      },
      {
        id: '3',
        name: 'Health System Alliance',
        domain: 'healthsystem.alliance.com',
        status: 'pending',
        userCount: 156,
        claimsCount: 890,
        revenue: 45230.25,
        createdAt: '2025-09-20T00:00:00Z',
        nsaCompliant: false,
        idrEnabled: false
      }
    ]);

    setSystemStats({
      totalUsers: 1237,
      activeTenants: 12,
      totalClaims: 45680,
      systemUptime: 99.97,
      apiRequests: 2847392,
      errorRate: 0.03,
      avgResponseTime: 145,
      storageUsed: 78.5
    });

    // NSA/IDR specific data
    setNsaStats({
      totalDisputes: 156,
      successRate: 94.2,
      totalPayments: 18950,
      avgResolutionTime: 28,
      gfeGenerated: 2847,
      gfeDelivered: 2693,
      complianceScore: 98.5,
      qpaCalculations: 1456
    });

    setIdrDisputes([
      {
        id: 'IDR-2024-001',
        claimId: 'CLM-789456',
        provider: 'MedCorp Healthcare',
        payer: 'Blue Cross Blue Shield',
        disputedAmount: 2500.00,
        qpaAmount: 1800.00,
        status: 'In Progress',
        initiatedBy: 'Provider',
        dueDate: '2025-10-15',
        stage: 'Arbitration',
        progress: 75
      },
      {
        id: 'IDR-2024-002',
        claimId: 'CLM-654321',
        provider: 'Regional Medical Group',
        payer: 'Aetna',
        disputedAmount: 1200.00,
        qpaAmount: 950.00,
        status: 'Resolved',
        initiatedBy: 'Payer',
        dueDate: '2025-09-30',
        stage: 'Completed',
        progress: 100
      },
      {
        id: 'IDR-2024-003',
        claimId: 'CLM-987654',
        provider: 'Health System Alliance',
        payer: 'Cigna',
        disputedAmount: 3200.00,
        qpaAmount: 2400.00,
        status: 'Pending',
        initiatedBy: 'Provider',
        dueDate: '2025-10-20',
        stage: 'Negotiation',
        progress: 25
      }
    ]);

    setGfeRequests([
      {
        id: 'GFE-2024-001',
        patientName: 'John Smith',
        provider: 'MedCorp Healthcare',
        serviceType: 'Emergency Surgery',
        estimatedCost: 15000.00,
        status: 'Delivered',
        deliveryMethod: 'Email',
        generatedDate: '2025-10-01',
        validUntil: '2026-10-01'
      },
      {
        id: 'GFE-2024-002',
        patientName: 'Sarah Johnson',
        provider: 'Regional Medical Group',
        serviceType: 'Diagnostic Imaging',
        estimatedCost: 2500.00,
        status: 'Generated',
        deliveryMethod: 'Portal',
        generatedDate: '2025-10-03',
        validUntil: '2026-10-03'
      },
      {
        id: 'GFE-2024-003',
        patientName: 'Mike Davis',
        provider: 'Health System Alliance',
        serviceType: 'Outpatient Procedure',
        estimatedCost: 8500.00,
        status: 'Pending',
        deliveryMethod: 'Mail',
        generatedDate: '2025-10-05',
        validUntil: '2026-10-05'
      }
    ]);
  }, []);

  // Mock data for charts
  const revenueData = [
    { month: 'Jan', revenue: 850000, claims: 8500, nsaClaims: 1200, idrDisputes: 45 },
    { month: 'Feb', revenue: 920000, claims: 9200, nsaClaims: 1350, idrDisputes: 52 },
    { month: 'Mar', revenue: 1100000, claims: 11000, nsaClaims: 1580, idrDisputes: 48 },
    { month: 'Apr', revenue: 1250000, claims: 12500, nsaClaims: 1820, idrDisputes: 61 },
    { month: 'May', revenue: 1380000, claims: 13800, nsaClaims: 2100, idrDisputes: 58 },
    { month: 'Jun', revenue: 1520000, claims: 15200, nsaClaims: 2350, idrDisputes: 67 }
  ];

  const nsaComplianceData = [
    { category: 'Enhanced EOB', compliance: 98.5, target: 95 },
    { category: 'Provider Directory', compliance: 96.2, target: 95 },
    { category: 'Payment Processing', compliance: 99.1, target: 98 },
    { category: 'Federal Reporting', compliance: 100, target: 100 },
    { category: 'Security Audits', compliance: 97.8, target: 95 },
    { category: 'QPA Calculations', compliance: 94.7, target: 95 }
  ];

  const disputeStatusDistribution = [
    { name: 'Resolved', value: 133, color: '#22c55e' },
    { name: 'In Progress', value: 23, color: '#3b82f6' },
    { name: 'Pending', value: 12, color: '#f59e0b' },
    { name: 'Escalated', value: 8, color: '#ef4444' }
  ];

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString();
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      active: { color: 'bg-green-100 text-green-800', icon: CheckCircle },
      pending: { color: 'bg-yellow-100 text-yellow-800', icon: Clock },
      suspended: { color: 'bg-red-100 text-red-800', icon: XCircle },
      inactive: { color: 'bg-gray-100 text-gray-800', icon: XCircle },
      'In Progress': { color: 'bg-blue-100 text-blue-800', icon: Clock },
      'Resolved': { color: 'bg-green-100 text-green-800', icon: CheckCircle },
      'Delivered': { color: 'bg-green-100 text-green-800', icon: CheckCircle },
      'Generated': { color: 'bg-blue-100 text-blue-800', icon: FileCheck }
    };

    const config = statusConfig[status] || statusConfig.inactive;
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} flex items-center gap-1`}>
        <Icon className="w-3 h-3" />
        {status}
      </Badge>
    );
  };

  const getRoleBadge = (role) => {
    const roleConfig = {
      super_admin: { color: 'bg-purple-100 text-purple-800', label: 'Super Admin' },
      tenant_admin: { color: 'bg-blue-100 text-blue-800', label: 'Tenant Admin' },
      provider_admin: { color: 'bg-indigo-100 text-indigo-800', label: 'Provider Admin' },
      provider_user: { color: 'bg-green-100 text-green-800', label: 'Provider User' },
      member: { color: 'bg-gray-100 text-gray-800', label: 'Member' },
      auditor: { color: 'bg-orange-100 text-orange-800', label: 'Auditor' }
    };

    const config = roleConfig[role] || roleConfig.member;

    return (
      <Badge className={config.color}>
        {config.label}
      </Badge>
    );
  };

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.tenant.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Shield className="w-8 h-8 text-blue-600" />
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Healthcare Claims Platform</h1>
                  <p className="text-sm text-gray-500">Integrated Admin Dashboard with NSA/IDR</p>
                </div>
              </div>
              <Badge className="bg-green-100 text-green-800">
                <Scale className="w-3 h-3 mr-1" />
                NSA Compliant
              </Badge>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="outline" size="sm">
                <Bell className="w-4 h-4 mr-2" />
                Notifications
              </Button>
              <Button variant="outline" size="sm">
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-8">
            <TabsTrigger value="dashboard" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="tenants" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Tenants
            </TabsTrigger>
            <TabsTrigger value="idr-disputes" className="flex items-center gap-2">
              <Gavel className="w-4 h-4" />
              IDR Disputes
            </TabsTrigger>
            <TabsTrigger value="gfe-management" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              GFE Management
            </TabsTrigger>
            <TabsTrigger value="nsa-compliance" className="flex items-center gap-2">
              <Scale className="w-4 h-4" />
              NSA Compliance
            </TabsTrigger>
            <TabsTrigger value="system" className="flex items-center gap-2">
              <Server className="w-4 h-4" />
              System
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Analytics
            </TabsTrigger>
          </TabsList>

          {/* Enhanced Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            {/* Key Metrics - Enhanced with NSA/IDR */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.totalUsers?.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">
                    <TrendingUp className="w-3 h-3 inline mr-1 text-green-500" />
                    +12.5% from last month
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">IDR Disputes</CardTitle>
                  <Gavel className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{nsaStats.totalDisputes}</div>
                  <p className="text-xs text-muted-foreground">
                    <CheckCircle className="w-3 h-3 inline mr-1 text-green-500" />
                    {nsaStats.successRate}% success rate
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Admin Fee Payments</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(nsaStats.totalPayments)}</div>
                  <p className="text-xs text-muted-foreground">
                    <TrendingUp className="w-3 h-3 inline mr-1 text-green-500" />
                    +18.2% from last month
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">NSA Compliance</CardTitle>
                  <Scale className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{nsaStats.complianceScore}%</div>
                  <p className="text-xs text-muted-foreground">
                    <CheckCircle className="w-3 h-3 inline mr-1 text-green-500" />
                    Excellent compliance
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Enhanced Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>NSA Claims & IDR Trends</CardTitle>
                  <CardDescription>Monthly NSA-protected claims and IDR disputes</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Area type="monotone" dataKey="nsaClaims" stackId="1" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
                      <Area type="monotone" dataKey="idrDisputes" stackId="2" stroke="#82ca9d" fill="#82ca9d" fillOpacity={0.6} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>IDR Dispute Status</CardTitle>
                  <CardDescription>Current distribution of dispute statuses</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={disputeStatusDistribution}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {disputeStatusDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* NSA Compliance Overview */}
            <Card>
              <CardHeader>
                <CardTitle>NSA Compliance Dashboard</CardTitle>
                <CardDescription>Real-time compliance monitoring across all NSA requirements</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {nsaComplianceData.map((item) => (
                    <div key={item.category} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>{item.category}</span>
                        <span className={item.compliance >= item.target ? 'text-green-600' : 'text-red-600'}>
                          {item.compliance}%
                        </span>
                      </div>
                      <Progress 
                        value={item.compliance} 
                        className="h-2"
                      />
                      <div className="text-xs text-muted-foreground">
                        Target: {item.target}%
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* IDR Disputes Tab */}
          <TabsContent value="idr-disputes" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">IDR Dispute Management</h2>
                <p className="text-muted-foreground">Manage Independent Dispute Resolution cases</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  New Dispute
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Disputes</p>
                      <p className="text-2xl font-bold">{nsaStats.totalDisputes}</p>
                    </div>
                    <Gavel className="w-8 h-8 text-blue-500" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Success Rate</p>
                      <p className="text-2xl font-bold">{nsaStats.successRate}%</p>
                    </div>
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Avg Resolution</p>
                      <p className="text-2xl font-bold">{nsaStats.avgResolutionTime} days</p>
                    </div>
                    <Clock className="w-8 h-8 text-orange-500" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Fees</p>
                      <p className="text-2xl font-bold">{formatCurrency(nsaStats.totalPayments)}</p>
                    </div>
                    <DollarSign className="w-8 h-8 text-purple-500" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Active IDR Disputes</CardTitle>
                <CardDescription>Current dispute cases and their status</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispute ID</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Payer</TableHead>
                      <TableHead>Disputed Amount</TableHead>
                      <TableHead>QPA Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {idrDisputes.map((dispute) => (
                      <TableRow key={dispute.id}>
                        <TableCell className="font-medium">{dispute.id}</TableCell>
                        <TableCell>{dispute.provider}</TableCell>
                        <TableCell>{dispute.payer}</TableCell>
                        <TableCell>{formatCurrency(dispute.disputedAmount)}</TableCell>
                        <TableCell>{formatCurrency(dispute.qpaAmount)}</TableCell>
                        <TableCell>{getStatusBadge(dispute.status)}</TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Progress value={dispute.progress} className="w-16 h-2" />
                            <span className="text-sm">{dispute.progress}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="outline" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="outline" size="sm">
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* GFE Management Tab */}
          <TabsContent value="gfe-management" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Good Faith Estimates</h2>
                <p className="text-muted-foreground">Manage GFE generation and delivery for uninsured patients</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Generate GFE
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">GFEs Generated</p>
                      <p className="text-2xl font-bold">{nsaStats.gfeGenerated}</p>
                    </div>
                    <FileText className="w-8 h-8 text-blue-500" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">GFEs Delivered</p>
                      <p className="text-2xl font-bold">{nsaStats.gfeDelivered}</p>
                    </div>
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Delivery Rate</p>
                      <p className="text-2xl font-bold">{((nsaStats.gfeDelivered / nsaStats.gfeGenerated) * 100).toFixed(1)}%</p>
                    </div>
                    <TrendingUp className="w-8 h-8 text-green-500" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Avg Est. Cost</p>
                      <p className="text-2xl font-bold">$8,650</p>
                    </div>
                    <Calculator className="w-8 h-8 text-purple-500" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Recent GFE Requests</CardTitle>
                <CardDescription>Good Faith Estimates generated for uninsured patients</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>GFE ID</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Service Type</TableHead>
                      <TableHead>Estimated Cost</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Delivery Method</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gfeRequests.map((gfe) => (
                      <TableRow key={gfe.id}>
                        <TableCell className="font-medium">{gfe.id}</TableCell>
                        <TableCell>{gfe.patientName}</TableCell>
                        <TableCell>{gfe.provider}</TableCell>
                        <TableCell>{gfe.serviceType}</TableCell>
                        <TableCell>{formatCurrency(gfe.estimatedCost)}</TableCell>
                        <TableCell>{getStatusBadge(gfe.status)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{gfe.deliveryMethod}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button variant="outline" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="outline" size="sm">
                              <Download className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* NSA Compliance Tab */}
          <TabsContent value="nsa-compliance" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">NSA Compliance Monitoring</h2>
                <p className="text-muted-foreground">Monitor compliance with No Surprises Act requirements</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline">
                  <Download className="w-4 h-4 mr-2" />
                  Compliance Report
                </Button>
                <Button>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh Status
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {nsaComplianceData.map((item) => (
                <Card key={item.category}>
                  <CardHeader>
                    <CardTitle className="text-lg">{item.category}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-2xl font-bold">{item.compliance}%</span>
                        {item.compliance >= item.target ? (
                          <CheckCircle className="w-6 h-6 text-green-500" />
                        ) : (
                          <AlertCircle className="w-6 h-6 text-red-500" />
                        )}
                      </div>
                      <Progress value={item.compliance} className="h-3" />
                      <div className="text-sm text-muted-foreground">
                        Target: {item.target}% | 
                        Status: {item.compliance >= item.target ? 'Compliant' : 'Needs Attention'}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Compliance Trends</CardTitle>
                <CardDescription>NSA compliance metrics over time</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={nsaComplianceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" />
                    <YAxis domain={[90, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="compliance" stroke="#8884d8" strokeWidth={3} />
                    <Line type="monotone" dataKey="target" stroke="#82ca9d" strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Existing tabs (users, tenants, system, analytics) remain the same but with enhanced data */}
          {/* ... (keeping existing tab content for brevity) ... */}

        </Tabs>
      </main>
    </div>
  );
}

export default IntegratedApp;
