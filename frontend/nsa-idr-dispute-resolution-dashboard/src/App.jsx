import { useState, useEffect } from 'react';
import { 
  Scale, 
  FileText, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  User, 
  Building, 
  DollarSign, 
  Calendar, 
  Upload, 
  Download, 
  Eye, 
  MessageSquare, 
  Filter, 
  Search,
  Plus,
  RefreshCw,
  Gavel,
  Shield,
  TrendingUp,
  Activity
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
  Cell
} from 'recharts';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import { ScrollArea } from '@/components/ui/scroll-area.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import './App.css';

export default function NSAIDRDisputeResolutionDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedCase, setSelectedCase] = useState(null);

  // Mock data for NSA/IDR Dispute Resolution
  const [idrData, setIdrData] = useState({
    overview: {
      totalCases: 1247,
      activeCases: 89,
      resolvedCases: 1158,
      averageResolutionTime: 45,
      successRate: 78.5,
      totalDisputedAmount: 15847392.50
    },
    cases: [
      {
        id: 'IDR-2024-001',
        claimId: 'CLM-789456',
        provider: 'General Hospital',
        payer: 'Blue Cross Blue Shield',
        patient: 'John Smith',
        serviceDate: '2024-09-15',
        disputedAmount: 12500.00,
        qpaAmount: 8500.00,
        status: 'In Review',
        priority: 'High',
        daysOpen: 12,
        arbitrator: 'Dr. Sarah Wilson',
        submissionDate: '2024-09-28',
        dueDate: '2024-10-28',
        serviceType: 'Emergency Surgery',
        documents: ['Medical Records', 'Billing Statement', 'Provider Contract'],
        timeline: [
          { date: '2024-09-28', event: 'Case Submitted', status: 'completed' },
          { date: '2024-09-30', event: 'Arbitrator Assigned', status: 'completed' },
          { date: '2024-10-02', event: 'Evidence Period Started', status: 'completed' },
          { date: '2024-10-08', event: 'Provider Response Due', status: 'current' },
          { date: '2024-10-15', event: 'Final Evidence Due', status: 'pending' },
          { date: '2024-10-28', event: 'Decision Due', status: 'pending' }
        ]
      },
      {
        id: 'IDR-2024-002',
        claimId: 'CLM-789457',
        provider: 'City Medical Center',
        payer: 'Aetna',
        patient: 'Jane Doe',
        serviceDate: '2024-09-10',
        disputedAmount: 8750.00,
        qpaAmount: 6200.00,
        status: 'Pending Decision',
        priority: 'Medium',
        daysOpen: 18,
        arbitrator: 'Dr. Michael Chen',
        submissionDate: '2024-09-22',
        dueDate: '2024-10-22',
        serviceType: 'Diagnostic Imaging',
        documents: ['Radiology Report', 'Prior Authorization', 'Payment History'],
        timeline: [
          { date: '2024-09-22', event: 'Case Submitted', status: 'completed' },
          { date: '2024-09-24', event: 'Arbitrator Assigned', status: 'completed' },
          { date: '2024-09-26', event: 'Evidence Period Started', status: 'completed' },
          { date: '2024-10-03', event: 'Provider Response Submitted', status: 'completed' },
          { date: '2024-10-08', event: 'Final Evidence Submitted', status: 'completed' },
          { date: '2024-10-22', event: 'Decision Due', status: 'current' }
        ]
      },
      {
        id: 'IDR-2024-003',
        claimId: 'CLM-789458',
        provider: 'Specialty Clinic',
        payer: 'United Healthcare',
        patient: 'Robert Johnson',
        serviceDate: '2024-08-25',
        disputedAmount: 15200.00,
        qpaAmount: 11800.00,
        status: 'Resolved - Provider Favor',
        priority: 'High',
        daysOpen: 0,
        arbitrator: 'Dr. Lisa Rodriguez',
        submissionDate: '2024-09-05',
        dueDate: '2024-10-05',
        serviceType: 'Surgical Procedure',
        documents: ['Operative Report', 'Anesthesia Records', 'Post-Op Notes'],
        finalAmount: 13500.00,
        resolutionDate: '2024-10-05',
        timeline: [
          { date: '2024-09-05', event: 'Case Submitted', status: 'completed' },
          { date: '2024-09-07', event: 'Arbitrator Assigned', status: 'completed' },
          { date: '2024-09-09', event: 'Evidence Period Started', status: 'completed' },
          { date: '2024-09-16', event: 'Provider Response Submitted', status: 'completed' },
          { date: '2024-09-23', event: 'Final Evidence Submitted', status: 'completed' },
          { date: '2024-10-05', event: 'Decision Rendered', status: 'completed' }
        ]
      }
    ],
    analytics: {
      casesByStatus: [
        { status: 'In Review', count: 45, color: '#f59e0b' },
        { status: 'Pending Decision', count: 32, color: '#3b82f6' },
        { status: 'Evidence Collection', count: 12, color: '#8b5cf6' },
        { status: 'Resolved', count: 1158, color: '#10b981' }
      ],
      resolutionTrend: [
        { month: 'Jan', resolved: 95, inFavor: 72, against: 23 },
        { month: 'Feb', resolved: 108, inFavor: 85, against: 23 },
        { month: 'Mar', resolved: 92, inFavor: 71, against: 21 },
        { month: 'Apr', resolved: 115, inFavor: 89, against: 26 },
        { month: 'May', resolved: 127, inFavor: 98, against: 29 },
        { month: 'Jun', resolved: 134, inFavor: 105, against: 29 }
      ],
      averageResolutionTime: [
        { month: 'Jan', days: 42 },
        { month: 'Feb', days: 38 },
        { month: 'Mar', days: 45 },
        { month: 'Apr', days: 41 },
        { month: 'May', days: 39 },
        { month: 'Jun', days: 43 }
      ]
    }
  });

  const getStatusBadge = (status) => {
    const statusConfig = {
      'In Review': { variant: 'secondary', color: 'bg-yellow-100 text-yellow-800' },
      'Pending Decision': { variant: 'default', color: 'bg-blue-100 text-blue-800' },
      'Evidence Collection': { variant: 'outline', color: 'bg-purple-100 text-purple-800' },
      'Resolved - Provider Favor': { variant: 'default', color: 'bg-green-100 text-green-800' },
      'Resolved - Payer Favor': { variant: 'destructive', color: 'bg-red-100 text-red-800' },
      'Resolved - Split Decision': { variant: 'secondary', color: 'bg-gray-100 text-gray-800' }
    };
    
    const config = statusConfig[status] || { variant: 'outline', color: 'bg-gray-100 text-gray-800' };
    return <Badge className={config.color}>{status}</Badge>;
  };

  const getPriorityIcon = (priority) => {
    switch (priority) {
      case 'High': return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case 'Medium': return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'Low': return <CheckCircle className="h-4 w-4 text-green-500" />;
      default: return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total IDR Cases</CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{idrData.overview.totalCases.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +12% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Cases</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{idrData.overview.activeCases}</div>
            <p className="text-xs text-muted-foreground">
              Currently in process
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Resolution Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{idrData.overview.averageResolutionTime} days</div>
            <p className="text-xs text-muted-foreground">
              Within federal guidelines
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{idrData.overview.successRate}%</div>
            <p className="text-xs text-muted-foreground">
              Provider favorable outcomes
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Cases by Status</CardTitle>
            <CardDescription>Current distribution of IDR cases</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={idrData.analytics.casesByStatus}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="count"
                  nameKey="status"
                  label
                >
                  {idrData.analytics.casesByStatus.map((entry, index) => (
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
            <CardTitle>Resolution Trends</CardTitle>
            <CardDescription>Monthly resolution outcomes</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={idrData.analytics.resolutionTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="inFavor" stackId="a" fill="#10b981" name="Provider Favor" />
                <Bar dataKey="against" stackId="a" fill="#ef4444" name="Payer Favor" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Average Resolution Time Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Average Resolution Time Trend</CardTitle>
          <CardDescription>Monthly average days to resolution</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={idrData.analytics.averageResolutionTime}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => [`${value} days`, 'Average Resolution Time']} />
              <Line type="monotone" dataKey="days" stroke="#8884d8" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );

  const renderCaseManagement = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">IDR Case Management</h2>
        <div className="flex items-center space-x-2">
          <Input placeholder="Search cases..." className="max-w-sm" />
          <Select>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cases</SelectItem>
              <SelectItem value="in-review">In Review</SelectItem>
              <SelectItem value="pending">Pending Decision</SelectItem>
              <SelectItem value="evidence">Evidence Collection</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Case
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {idrData.cases.map((idrCase) => (
          <Card key={idrCase.id} className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setSelectedCase(idrCase)}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    {getPriorityIcon(idrCase.priority)}
                    <h3 className="text-lg font-semibold">{idrCase.id}</h3>
                  </div>
                  {getStatusBadge(idrCase.status)}
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Disputed Amount</p>
                  <p className="text-lg font-bold text-red-600">${idrCase.disputedAmount.toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">Provider</p>
                  <p className="font-medium">{idrCase.provider}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Payer</p>
                  <p className="font-medium">{idrCase.payer}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Service Type</p>
                  <p className="font-medium">{idrCase.serviceType}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Patient</p>
                  <p className="font-medium">{idrCase.patient}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Service Date</p>
                  <p className="font-medium">{idrCase.serviceDate}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Arbitrator</p>
                  <p className="font-medium">{idrCase.arbitrator}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Days Open</p>
                  <p className="font-medium">{idrCase.status.includes('Resolved') ? 'Closed' : `${idrCase.daysOpen} days`}</p>
                </div>
              </div>

              {idrCase.status.includes('Resolved') && (
                <div className="mt-4 p-3 bg-green-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-green-800">Final Resolution Amount:</span>
                    <span className="text-lg font-bold text-green-600">${idrCase.finalAmount?.toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-green-600 mt-1">Resolved on {idrCase.resolutionDate}</p>
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
            <Scale className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Select a case to view details</p>
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
            {getStatusBadge(selectedCase.status)}
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Export Case
            </Button>
            <Button>
              <MessageSquare className="mr-2 h-4 w-4" />
              Contact Arbitrator
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Case Information */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Case Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Claim ID</p>
                    <p className="font-medium">{selectedCase.claimId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Service Date</p>
                    <p className="font-medium">{selectedCase.serviceDate}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Provider</p>
                    <p className="font-medium">{selectedCase.provider}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Payer</p>
                    <p className="font-medium">{selectedCase.payer}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Patient</p>
                    <p className="font-medium">{selectedCase.patient}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Service Type</p>
                    <p className="font-medium">{selectedCase.serviceType}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Financial Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Disputed Amount</p>
                    <p className="text-xl font-bold text-red-600">${selectedCase.disputedAmount.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">QPA Amount</p>
                    <p className="text-xl font-bold text-blue-600">${selectedCase.qpaAmount.toLocaleString()}</p>
                  </div>
                </div>
                {selectedCase.finalAmount && (
                  <div className="pt-4 border-t">
                    <p className="text-sm text-muted-foreground">Final Resolution Amount</p>
                    <p className="text-2xl font-bold text-green-600">${selectedCase.finalAmount.toLocaleString()}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Case Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {selectedCase.timeline.map((event, index) => (
                    <div key={index} className="flex items-center space-x-4">
                      <div className={`w-3 h-3 rounded-full ${
                        event.status === 'completed' ? 'bg-green-500' : 
                        event.status === 'current' ? 'bg-blue-500' : 'bg-gray-300'
                      }`} />
                      <div className="flex-1">
                        <p className="font-medium">{event.event}</p>
                        <p className="text-sm text-muted-foreground">{event.date}</p>
                      </div>
                      {event.status === 'completed' && <CheckCircle className="h-4 w-4 text-green-500" />}
                      {event.status === 'current' && <Clock className="h-4 w-4 text-blue-500" />}
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
                <CardTitle>Case Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Arbitrator</p>
                  <div className="flex items-center space-x-2 mt-1">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback>{selectedCase.arbitrator.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                    </Avatar>
                    <p className="font-medium">{selectedCase.arbitrator}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Priority</p>
                  <div className="flex items-center space-x-2 mt-1">
                    {getPriorityIcon(selectedCase.priority)}
                    <p className="font-medium">{selectedCase.priority}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Submission Date</p>
                  <p className="font-medium">{selectedCase.submissionDate}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Decision Due Date</p>
                  <p className="font-medium">{selectedCase.dueDate}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {selectedCase.documents.map((doc, index) => (
                    <div key={index} className="flex items-center justify-between p-2 border rounded">
                      <div className="flex items-center space-x-2">
                        <FileText className="h-4 w-4" />
                        <span className="text-sm">{doc}</span>
                      </div>
                      <Button variant="ghost" size="sm">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button className="w-full mt-4">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Document
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
        <h2 className="text-2xl font-bold">IDR Analytics</h2>
        <div className="flex items-center space-x-2">
          <Select>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Time Period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
              <SelectItem value="6m">Last 6 Months</SelectItem>
              <SelectItem value="1y">Last Year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Key Performance Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Disputed Amount</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${idrData.overview.totalDisputedAmount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Across all cases
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Provider Win Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{idrData.overview.successRate}%</div>
            <p className="text-xs text-muted-foreground">
              Cases resolved in provider favor
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Case Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${(idrData.overview.totalDisputedAmount / idrData.overview.totalCases).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Per dispute case
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Compliance Rate</CardTitle>
            <Shield className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">98.2%</div>
            <p className="text-xs text-muted-foreground">
              Federal timeline compliance
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Resolution Outcomes</CardTitle>
            <CardDescription>Provider vs Payer favorable decisions</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={idrData.analytics.resolutionTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="inFavor" fill="#10b981" name="Provider Favor" />
                <Bar dataKey="against" fill="#ef4444" name="Payer Favor" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resolution Time Performance</CardTitle>
            <CardDescription>Average days to case resolution</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={idrData.analytics.averageResolutionTime}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => [`${value} days`, 'Resolution Time']} />
                <Line type="monotone" dataKey="days" stroke="#8884d8" strokeWidth={3} />
              </LineChart>
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
            <Scale className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">NSA/IDR Dispute Resolution</h1>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm">
              <Gavel className="mr-2 h-4 w-4" />
              Federal IDR Portal
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
