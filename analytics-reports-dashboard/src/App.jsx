
import { useState, useEffect } from 'react';
import { 
  BarChart3, 
  PieChart, 
  TrendingUp, 
  Download, 
  Filter, 
  Calendar, 
  Settings, 
  RefreshCw, 
  FileText, 
  DollarSign, 
  Users, 
  Activity, 
  AlertTriangle, 
  CheckCircle 
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
  Cell 
} from 'recharts';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
// import { DateRangePicker } from '@/components/ui/date-range-picker.jsx'; // Assuming this component exists

export default function AnalyticsReportsDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [dateRange, setDateRange] = useState({
    from: new Date(new Date().setFullYear(new Date().getFullYear() - 1)),
    to: new Date(),
  });

  // Mock data for Analytics & Reports
  const [analyticsData, setAnalyticsData] = useState({
    overview: {
      totalClaims: 158472,
      totalBilled: 28473920.50,
      avgClaimAmount: 179.68,
      approvalRate: 92.5,
      fraudRate: 1.2,
      patientGrowth: 15.3,
    },
    claimsAnalytics: {
      volumeTrend: [
        { month: 'Jan', count: 12000 },
        { month: 'Feb', count: 13500 },
        { month: 'Mar', count: 11800 },
        { month: 'Apr', count: 14200 },
        { month: 'May', count: 15800 },
        { month: 'Jun', count: 16500 },
      ],
      amountTrend: [
        { month: 'Jan', amount: 2160000 },
        { month: 'Feb', amount: 2430000 },
        { month: 'Mar', amount: 2124000 },
        { month: 'Apr', amount: 2556000 },
        { month: 'May', amount: 2844000 },
        { month: 'Jun', amount: 2970000 },
      ],
      statusDistribution: [
        { status: 'Approved', count: 146586, color: '#10b981' },
        { status: 'Pending', count: 1256, color: '#f59e0b' },
        { status: 'Denied', count: 10930, color: '#ef4444' },
      ],
    },
    providerAnalytics: {
      topPerforming: [
        { name: 'General Hospital', claims: 12543, amount: 12500000 },
        { name: 'Dr. Sarah Johnson', claims: 8921, amount: 8900000 },
        { name: 'City Urgent Care', claims: 5634, amount: 4500000 },
      ],
      satisfactionScores: [
        { name: 'General Hospital', score: 95 },
        { name: 'Dr. Sarah Johnson', score: 91 },
        { name: 'City Urgent Care', score: 88 },
      ],
    },
    financialAnalytics: {
      revenueByService: [
        { service: 'Consultation', revenue: 8500000, color: '#3b82f6' },
        { service: 'Surgery', revenue: 12500000, color: '#10b981' },
        { service: 'Medication', revenue: 4500000, color: '#f97316' },
        { service: 'Therapy', revenue: 2973920, color: '#8b5cf6' },
      ],
      costVsRevenue: [
        { month: 'Jan', revenue: 2160000, cost: 1500000 },
        { month: 'Feb', revenue: 2430000, cost: 1700000 },
        { month: 'Mar', revenue: 2124000, cost: 1450000 },
      ],
    },
  });

  const renderOverview = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Claims Processed</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{analyticsData.overview.totalClaims.toLocaleString()}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Billed Amount</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${analyticsData.overview.totalBilled.toLocaleString()}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Average Claim Amount</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${analyticsData.overview.avgClaimAmount.toLocaleString()}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Claim Approval Rate</CardTitle>
          <CheckCircle className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{analyticsData.overview.approvalRate}%</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Fraud Detection Rate</CardTitle>
          <AlertTriangle className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">{analyticsData.overview.fraudRate}%</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Patient Growth</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">+{analyticsData.overview.patientGrowth}%</div>
        </CardContent>
      </Card>
    </div>
  );

  const renderClaimsAnalytics = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Claims Volume Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={analyticsData.claimsAnalytics.volumeTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#8884d8" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Claims Amount Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analyticsData.claimsAnalytics.amountTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
              <Bar dataKey="amount" fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Claims Status Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <RechartsPieChart>
              <Pie data={analyticsData.claimsAnalytics.statusDistribution} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={100} fill="#8884d8" label>
                {analyticsData.claimsAnalytics.statusDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </RechartsPieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );

  const renderProviderAnalytics = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Top Performing Providers by Claim Amount</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analyticsData.providerAnalytics.topPerforming} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" />
              <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
              <Bar dataKey="amount" fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Provider Satisfaction Scores</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analyticsData.providerAnalytics.satisfactionScores}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="score" fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );

  const renderFinancialAnalytics = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Service Type</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <RechartsPieChart>
              <Pie data={analyticsData.financialAnalytics.revenueByService} dataKey="revenue" nameKey="service" cx="50%" cy="50%" outerRadius={100} fill="#8884d8" label>
                {analyticsData.financialAnalytics.revenueByService.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
            </RechartsPieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cost vs. Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={analyticsData.financialAnalytics.costVsRevenue}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
              <Line type="monotone" dataKey="revenue" stroke="#82ca9d" />
              <Line type="monotone" dataKey="cost" stroke="#ef4444" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );

  const renderReports = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Generate Reports</CardTitle>
          <CardDescription>Select a report type and date range to generate and download a report.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-4">
            <Select>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Select a report type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claims_summary">Claims Summary</SelectItem>
                <SelectItem value="provider_performance">Provider Performance</SelectItem>
                <SelectItem value="financial_overview">Financial Overview</SelectItem>
                <SelectItem value="fraud_analysis">Fraud Analysis</SelectItem>
              </SelectContent>
            </Select>
            {/* <DateRangePicker date={dateRange} onDateChange={setDateRange} /> */}
          </div>
          <Button>
            <Download className="mr-2 h-4 w-4" />
            Generate and Download Report
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Analytics & Reports</h1>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Data
          </Button>
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="claims">Claims Analytics</TabsTrigger>
          <TabsTrigger value="providers">Provider Analytics</TabsTrigger>
          <TabsTrigger value="financials">Financial Analytics</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          {renderOverview()}
        </TabsContent>
        <TabsContent value="claims" className="mt-6">
          {renderClaimsAnalytics()}
        </TabsContent>
        <TabsContent value="providers" className="mt-6">
          {renderProviderAnalytics()}
        </TabsContent>
        <TabsContent value="financials" className="mt-6">
          {renderFinancialAnalytics()}
        </TabsContent>
        <TabsContent value="reports" className="mt-6">
          {renderReports()}
        </TabsContent>
      </Tabs>
    </div>
  );
}

