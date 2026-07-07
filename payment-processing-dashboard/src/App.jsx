
import { useState, useEffect } from 'react';
import { 
  DollarSign, 
  CreditCard, 
  TrendingUp, 
  TrendingDown, 
  Filter, 
  Download, 
  Calendar, 
  Clock, 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  Search 
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
  Bar 
} from 'recharts';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';

export default function PaymentProcessingDashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  // Mock data for Payment Processing
  const [paymentData, setPaymentData] = useState({
    overview: {
      totalVolume: 7854321.50,
      totalTransactions: 12345,
      avgTransactionValue: 636.21,
      successRate: 98.2,
    },
    transactions: [
      { id: 'TXN-001', claimId: 'CLM-001', provider: 'General Hospital', amount: 1250.00, status: 'success', date: '2024-10-08' },
      { id: 'TXN-002', claimId: 'CLM-002', provider: 'Dr. Sarah Johnson', amount: 890.00, status: 'pending', date: '2024-10-08' },
      { id: 'TXN-003', claimId: 'CLM-004', provider: 'City Urgent Care', amount: 450.00, status: 'failed', date: '2024-10-07' },
    ],
    payouts: [
      { id: 'PAY-001', provider: 'General Hospital', amount: 150000.00, status: 'paid', date: '2024-10-05' },
      { id: 'PAY-002', provider: 'Dr. Sarah Johnson', amount: 75000.00, status: 'scheduled', date: '2024-10-10' },
    ],
    chartData: {
      volumeTrend: [
        { month: 'Jan', volume: 1200000 },
        { month: 'Feb', volume: 1350000 },
        { month: 'Mar', volume: 1180000 },
      ],
      transactionTrend: [
        { month: 'Jan', count: 2000 },
        { month: 'Feb', count: 2200 },
        { month: 'Mar', count: 1900 },
      ],
    },
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'success':
      case 'paid':
        return <Badge variant="default" className="bg-green-500">Success</Badge>;
      case 'pending':
      case 'scheduled':
        return <Badge variant="secondary">Pending</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const renderOverview = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Volume</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${paymentData.overview.totalVolume.toLocaleString()}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
          <CreditCard className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{paymentData.overview.totalTransactions.toLocaleString()}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Avg. Transaction Value</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${paymentData.overview.avgTransactionValue.toLocaleString()}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
          <CheckCircle className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{paymentData.overview.successRate}%</div>
        </CardContent>
      </Card>
    </div>
  );

  const renderTransactions = () => (
    <Card>
      <CardHeader>
        <CardTitle>Transactions</CardTitle>
        <div className="flex items-center space-x-2">
          <Input placeholder="Search transactions..." className="max-w-sm" />
          <Button variant="outline"><Filter className="mr-2 h-4 w-4" /> Filter</Button>
          <Button><Download className="mr-2 h-4 w-4" /> Export</Button>
        </div>
      </CardHeader>
      <CardContent>
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Transaction ID</th>
              <th className="text-left p-2">Claim ID</th>
              <th className="text-left p-2">Provider</th>
              <th className="text-left p-2">Amount</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {paymentData.transactions.map((txn) => (
              <tr key={txn.id} className="border-b">
                <td className="p-2">{txn.id}</td>
                <td className="p-2">{txn.claimId}</td>
                <td className="p-2">{txn.provider}</td>
                <td className="p-2">${txn.amount.toLocaleString()}</td>
                <td className="p-2">{getStatusBadge(txn.status)}</td>
                <td className="p-2">{txn.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

  const renderPayouts = () => (
    <Card>
      <CardHeader>
        <CardTitle>Payouts to Providers</CardTitle>
        <Button><Download className="mr-2 h-4 w-4" /> Export Payouts</Button>
      </CardHeader>
      <CardContent>
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Payout ID</th>
              <th className="text-left p-2">Provider</th>
              <th className="text-left p-2">Amount</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {paymentData.payouts.map((payout) => (
              <tr key={payout.id} className="border-b">
                <td className="p-2">{payout.id}</td>
                <td className="p-2">{payout.provider}</td>
                <td className="p-2">${payout.amount.toLocaleString()}</td>
                <td className="p-2">{getStatusBadge(payout.status)}</td>
                <td className="p-2">{payout.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );

  const renderAnalytics = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Payment Volume Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={paymentData.chartData.volumeTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
              <Line type="monotone" dataKey="volume" stroke="#8884d8" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Transaction Count Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={paymentData.chartData.transactionTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Payment Processing</h1>
        <Button variant="outline" size="sm"><RefreshCw className="mr-2 h-4 w-4" /> Refresh Data</Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          {renderOverview()}
        </TabsContent>
        <TabsContent value="transactions" className="mt-6">
          {renderTransactions()}
        </TabsContent>
        <TabsContent value="payouts" className="mt-6">
          {renderPayouts()}
        </TabsContent>
        <TabsContent value="analytics" className="mt-6">
          {renderAnalytics()}
        </TabsContent>
      </Tabs>
    </div>
  );
}

