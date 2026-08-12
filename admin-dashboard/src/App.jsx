import React from 'react';
import IntegratedApp from './IntegratedApp.jsx';

function App() {
  return <IntegratedApp />;
}

export default App;

// Original App component preserved below for reference
/*
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
  TrendingDown
} from 'lucide-react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [systemStats, setSystemStats] = useState({});
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Mock data for demonstration
  useEffect(() => {
    // Simulate API calls
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
        createdAt: '2024-06-01T00:00:00Z'
      },
      {
        id: '2',
        name: 'Regional Medical Group',
        domain: 'regional.medical.com',
        status: 'active',
        userCount: 234,
        claimsCount: 3200,
        revenue: 125450.00,
        createdAt: '2024-08-15T00:00:00Z'
      },
      {
        id: '3',
        name: 'Health System Alliance',
        domain: 'healthsystem.alliance.com',
        status: 'pending',
        userCount: 156,
        claimsCount: 890,
        revenue: 45230.25,
        createdAt: '2025-09-20T00:00:00Z'
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
  }, []);

  // Mock data for charts
  const revenueData = [
    { month: 'Jan', revenue: 850000, claims: 8500 },
    { month: 'Feb', revenue: 920000, claims: 9200 },
    { month: 'Mar', revenue: 1100000, claims: 11000 },
    { month: 'Apr', revenue: 1250000, claims: 12500 },
    { month: 'May', revenue: 1380000, claims: 13800 },
    { month: 'Jun', revenue: 1520000, claims: 15200 }
  ];

  const userGrowthData = [
    { month: 'Jan', users: 890 },
    { month: 'Feb', users: 945 },
    { month: 'Mar', users: 1020 },
    { month: 'Apr', users: 1105 },
    { month: 'May', users: 1180 },
    { month: 'Jun', users: 1237 }
  ];

  const tenantDistribution = [
    { name: 'Enterprise', value: 35, color: '#8884d8' },
    { name: 'Premium', value: 28, color: '#82ca9d' },
    { name: 'Standard', value: 22, color: '#ffc658' },
    { name: 'Basic', value: 15, color: '#ff7300' }
  ];

  const systemMetrics = [
    { name: 'CPU Usage', value: 45, color: '#8884d8' },
    { name: 'Memory', value: 62, color: '#82ca9d' },
    { name: 'Disk I/O', value: 28, color: '#ffc658' },
    { name: 'Network', value: 35, color: '#ff7300' }
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
      inactive: { color: 'bg-gray-100 text-gray-800', icon: XCircle }
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
                  <p className="text-sm text-gray-500">Admin Dashboard</p>
                </div>
              </div>
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
          <TabsList className="grid w-full grid-cols-6">
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
            <TabsTrigger value="system" className="flex items-center gap-2">
              <Server className="w-4 h-4" />
              System
            </TabsTrigger>
            <TabsTrigger value="security" className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Security
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Analytics
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            {/* Key Metrics */}
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
                  <CardTitle className="text-sm font-medium">Active Tenants</CardTitle>
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.activeTenants}</div>
                  <p className="text-xs text-muted-foreground">
                    <TrendingUp className="w-3 h-3 inline mr-1 text-green-500" />
                    +2 new this month
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Claims</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.totalClaims?.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">
                    <TrendingUp className="w-3 h-3 inline mr-1 text-green-500" />
                    +18.2% from last month
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">System Uptime</CardTitle>
                  <Zap className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.systemUptime}%</div>
                  <p className="text-xs text-muted-foreground">
                    <CheckCircle className="w-3 h-3 inline mr-1 text-green-500" />
                    Excellent performance
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Revenue Growth</CardTitle>
                  <CardDescription>Monthly revenue and claims processed</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip formatter={(value, name) => [
                        name === 'revenue' ? formatCurrency(value) : value.toLocaleString(),
                        name === 'revenue' ? 'Revenue' : 'Claims'
                      ]} />
                      <Area type="monotone" dataKey="revenue" stackId="1" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>User Growth</CardTitle>
                  <CardDescription>Platform user acquisition over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={userGrowthData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="users" stroke="#82ca9d" strokeWidth={3} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* System Health */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>System Performance</CardTitle>
                  <CardDescription>Real-time system metrics</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {systemMetrics.map((metric) => (
                    <div key={metric.name} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>{metric.name}</span>
                        <span>{metric.value}%</span>
                      </div>
                      <Progress value={metric.value} className="h-2" />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Tenant Distribution</CardTitle>
                  <CardDescription>Tenants by subscription tier</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={tenantDistribution}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}%`}
                      >
                        {tenantDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">User Management</h2>
                <p className="text-gray-600">Manage platform users and their permissions</p>
              </div>
              <Button>
                <UserPlus className="w-4 h-4 mr-2" />
                Add User
              </Button>
            </div>

            {/* Search and Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search users..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                  </div>
                  <Select defaultValue="all">
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Filter by role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="super_admin">Super Admin</SelectItem>
                      <SelectItem value="tenant_admin">Tenant Admin</SelectItem>
                      <SelectItem value="provider_admin">Provider Admin</SelectItem>
                      <SelectItem value="provider_user">Provider User</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select defaultValue="all">
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Users Table */}
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Login</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{user.firstName} {user.lastName}</div>
                            <div className="text-sm text-gray-500">{user.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>{getRoleBadge(user.role)}</TableCell>
                        <TableCell className="text-sm">{user.tenant}</TableCell>
                        <TableCell>{getStatusBadge(user.status)}</TableCell>
                        <TableCell className="text-sm">{formatDate(user.lastLogin)}</TableCell>
                        <TableCell className="text-sm">{formatDate(user.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Trash2 className="w-4 h-4" />
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

          {/* Tenants Tab */}
          <TabsContent value="tenants" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Tenant Management</h2>
                <p className="text-gray-600">Manage healthcare organizations and their configurations</p>
              </div>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Tenant
              </Button>
            </div>

            {/* Tenants Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {tenants.map((tenant) => (
                <Card key={tenant.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">{tenant.name}</CardTitle>
                        <CardDescription>{tenant.domain}</CardDescription>
                      </div>
                      {getStatusBadge(tenant.status)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-gray-500">Users</div>
                        <div className="font-semibold">{tenant.userCount.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Claims</div>
                        <div className="font-semibold">{tenant.claimsCount.toLocaleString()}</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-sm">Monthly Revenue</div>
                      <div className="text-lg font-bold text-green-600">{formatCurrency(tenant.revenue)}</div>
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-sm text-gray-500">
                        Created {formatDate(tenant.createdAt)}
                      </span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          <Settings className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="sm">
                          <Eye className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* System Tab */}
          <TabsContent value="system" className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">System Administration</h2>
              <p className="text-gray-600">Monitor and manage platform infrastructure</p>
            </div>

            {/* System Health Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">API Requests</CardTitle>
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.apiRequests?.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">Last 24 hours</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.errorRate}%</div>
                  <p className="text-xs text-muted-foreground">
                    <CheckCircle className="w-3 h-3 inline mr-1 text-green-500" />
                    Within acceptable range
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.avgResponseTime}ms</div>
                  <p className="text-xs text-muted-foreground">Excellent performance</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Storage Used</CardTitle>
                  <Database className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.storageUsed}%</div>
                  <Progress value={systemStats.storageUsed} className="mt-2" />
                </CardContent>
              </Card>
            </div>

            {/* System Actions */}
            <Card>
              <CardHeader>
                <CardTitle>System Actions</CardTitle>
                <CardDescription>Perform system maintenance and configuration tasks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Button variant="outline" className="h-20 flex-col">
                    <RefreshCw className="w-6 h-6 mb-2" />
                    Restart Services
                  </Button>
                  <Button variant="outline" className="h-20 flex-col">
                    <Download className="w-6 h-6 mb-2" />
                    Export Logs
                  </Button>
                  <Button variant="outline" className="h-20 flex-col">
                    <Upload className="w-6 h-6 mb-2" />
                    Import Config
                  </Button>
                  <Button variant="outline" className="h-20 flex-col">
                    <Database className="w-6 h-6 mb-2" />
                    Backup Database
                  </Button>
                  <Button variant="outline" className="h-20 flex-col">
                    <Settings className="w-6 h-6 mb-2" />
                    System Settings
                  </Button>
                  <Button variant="outline" className="h-20 flex-col">
                    <Activity className="w-6 h-6 mb-2" />
                    Health Check
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Security Management</h2>
              <p className="text-gray-600">Monitor security events and manage access controls</p>
            </div>

            {/* Security Alerts */}
            <div className="space-y-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Security Alert</AlertTitle>
                <AlertDescription>
                  3 failed login attempts detected from IP 192.168.1.100 in the last hour.
                </AlertDescription>
              </Alert>

              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Security Update</AlertTitle>
                <AlertDescription>
                  All security patches have been successfully applied. System is up to date.
                </AlertDescription>
              </Alert>
            </div>

            {/* Security Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Access Control</CardTitle>
                  <CardDescription>Manage user permissions and access policies</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button variant="outline" className="w-full justify-start">
                    <Lock className="w-4 h-4 mr-2" />
                    Manage Permissions
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    <Shield className="w-4 h-4 mr-2" />
                    Security Policies
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    <Users className="w-4 h-4 mr-2" />
                    Role Management
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Security Monitoring</CardTitle>
                  <CardDescription>Monitor security events and threats</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button variant="outline" className="w-full justify-start">
                    <Activity className="w-4 h-4 mr-2" />
                    Audit Logs
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    Security Events
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    <Eye className="w-4 h-4 mr-2" />
                    Threat Detection
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Platform Analytics</h2>
              <p className="text-gray-600">Comprehensive insights into platform usage and performance</p>
            </div>

            {/* Analytics Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Claims Processing Trends</CardTitle>
                  <CardDescription>Monthly claims volume and processing efficiency</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={revenueData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="claims" fill="#8884d8" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Platform Usage</CardTitle>
                  <CardDescription>User activity and engagement metrics</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={userGrowthData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="users" stroke="#82ca9d" strokeWidth={3} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Key Performance Indicators */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Processing Efficiency</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-green-600">96.8%</div>
                  <p className="text-sm text-gray-500">Claims processed successfully</p>
                  <Progress value={96.8} className="mt-2" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>User Satisfaction</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-blue-600">4.7/5</div>
                  <p className="text-sm text-gray-500">Average user rating</p>
                  <Progress value={94} className="mt-2" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Revenue Growth</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-purple-600">+22.5%</div>
                  <p className="text-sm text-gray-500">Quarter over quarter</p>
                  <Progress value={75} className="mt-2" />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default App;
