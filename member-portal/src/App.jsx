import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Heart, 
  FileText, 
  DollarSign, 
  Calendar, 
  User, 
  Bell, 
  Settings, 
  ChevronDown, 
  Search, 
  Filter, 
  Download, 
  Eye, 
  CheckCircle, 
  XCircle, 
  Clock, 
  BarChart3, 
  TrendingUp, 
  Activity 
} from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [claims, setClaims] = useState([]);
  const [benefits, setBenefits] = useState([]);
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [notifications, setNotifications] = useState(3);

  // Mock data
  useEffect(() => {
    setClaims([
      {
        id: 'CLM-001',
        providerName: 'City Hospital',
        serviceDate: '2024-01-15',
        billedAmount: 1250.00,
        paidAmount: 1000.00,
        yourResponsibility: 250.00,
        status: 'processed',
        details: 'Emergency Room Visit'
      },
      {
        id: 'CLM-002',
        providerName: 'Dr. Sarah Johnson',
        serviceDate: '2024-01-14',
        billedAmount: 850.00,
        paidAmount: 680.00,
        yourResponsibility: 170.00,
        status: 'processed',
        details: 'Specialist Consultation'
      },
      {
        id: 'CLM-003',
        providerName: 'Downtown Clinic',
        serviceDate: '2024-01-13',
        billedAmount: 2100.00,
        paidAmount: 0,
        yourResponsibility: 2100.00,
        status: 'denied',
        details: 'Out-of-Network Service'
      },
      {
        id: 'CLM-004',
        providerName: 'General Hospital',
        serviceDate: '2024-01-12',
        billedAmount: 950.00,
        paidAmount: 0,
        yourResponsibility: 0,
        status: 'pending',
        details: 'Lab Tests'
      }
    ]);

    setBenefits([
      { name: 'Deductible', total: 3000, used: 1200, remaining: 1800 },
      { name: 'Out-of-Pocket Max', total: 6000, used: 2500, remaining: 3500 },
      { name: 'Specialist Visits', total: 20, used: 5, remaining: 15 },
      { name: 'Hospital Stays', total: 10, used: 1, remaining: 9 }
    ]);
  }, []);

  const dashboardMetrics = {
    totalClaims: claims.length,
    totalBilled: claims.reduce((sum, c) => sum + c.billedAmount, 0),
    totalPaid: claims.reduce((sum, c) => sum + c.paidAmount, 0),
    yourTotalResponsibility: claims.reduce((sum, c) => sum + c.yourResponsibility, 0)
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'processed': return 'bg-green-100 text-green-800';
      case 'denied': return 'bg-red-100 text-red-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'processed': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'denied': return <XCircle className="w-4 h-4 text-red-600" />;
      case 'pending': return <Clock className="w-4 h-4 text-yellow-600" />;
      default: return <FileText className="w-4 h-4 text-gray-600" />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <ShieldCheck className="h-8 w-8 text-blue-600" />
              <h1 className="ml-2 text-xl font-semibold text-gray-900">Member Portal</h1>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" className="relative">
                <Bell className="h-5 w-5" />
                {notifications > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                    {notifications}
                  </Badge>
                )}
              </Button>
              <div className="flex items-center space-x-2">
                <User className="h-5 w-5 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">John Doe</span>
                <ChevronDown className="h-4 w-4 text-gray-600" />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="claims">My Claims</TabsTrigger>
            <TabsTrigger value="benefits">My Benefits</TabsTrigger>
            <TabsTrigger value="profile">My Profile</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">Welcome, John!</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Claims</CardTitle>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{dashboardMetrics.totalClaims}</div>
                    <p className="text-xs text-muted-foreground">This year</p>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Paid by Plan</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${dashboardMetrics.totalPaid.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">This year</p>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Your Responsibility</CardTitle>
                    <User className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${dashboardMetrics.yourTotalResponsibility.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">This year</p>
                  </CardContent>
                </Card>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Deductible Remaining</CardTitle>
                    <Heart className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">${benefits.find(b => b.name === 'Deductible')?.remaining.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">Out of ${benefits.find(b => b.name === 'Deductible')?.total.toLocaleString()}</p>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Recent Claims</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {claims.slice(0, 3).map((claim) => (
                    <div key={claim.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-4">
                        {getStatusIcon(claim.status)}
                        <div>
                          <p className="font-medium">{claim.id} - {claim.providerName}</p>
                          <p className="text-sm text-gray-600">{claim.details}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <Badge className={getStatusColor(claim.status)}>{claim.status}</Badge>
                        <p className="font-medium">${claim.billedAmount.toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="claims" className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">My Claims</h2>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim ID</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Service Date</TableHead>
                      <TableHead>Billed</TableHead>
                      <TableHead>Paid by Plan</TableHead>
                      <TableHead>Your Responsibility</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {claims.map((claim) => (
                      <TableRow key={claim.id}>
                        <TableCell className="font-medium">{claim.id}</TableCell>
                        <TableCell>{claim.providerName}</TableCell>
                        <TableCell>{claim.serviceDate}</TableCell>
                        <TableCell>${claim.billedAmount.toLocaleString()}</TableCell>
                        <TableCell>${claim.paidAmount.toLocaleString()}</TableCell>
                        <TableCell>${claim.yourResponsibility.toLocaleString()}</TableCell>
                        <TableCell><Badge className={getStatusColor(claim.status)}>{claim.status}</Badge></TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => setSelectedClaim(claim)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="benefits" className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">My Benefits</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {benefits.map(benefit => (
                <Card key={benefit.name}>
                  <CardHeader>
                    <CardTitle>{benefit.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-muted-foreground">Used: ${benefit.used.toLocaleString()}</span>
                      <span className="text-muted-foreground">Total: ${benefit.total.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div 
                        className="bg-blue-600 h-2.5 rounded-full"
                        style={{ width: `${(benefit.used / benefit.total) * 100}%` }}
                      ></div>
                    </div>
                    <p className="text-right mt-2 font-medium">${benefit.remaining.toLocaleString()} Remaining</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="profile" className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">My Profile</h2>
            <Card>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Name</Label><p>John Doe</p></div>
                  <div><Label>Date of Birth</Label><p>1985-05-20</p></div>
                  <div><Label>Member ID</Label><p>MBR123456789</p></div>
                  <div><Label>Plan</Label><p>Gold PPO</p></div>
                  <div><Label>Email</Label><p>john.doe@email.com</p></div>
                  <div><Label>Phone</Label><p>(555) 555-5555</p></div>
                </div>
                <Button>Edit Profile</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {selectedClaim && (
        <Dialog open={!!selectedClaim} onOpenChange={() => setSelectedClaim(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Claim Details - {selectedClaim.id}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Provider</Label><p className="font-medium">{selectedClaim.providerName}</p></div>
                <div><Label>Service Date</Label><p className="font-medium">{selectedClaim.serviceDate}</p></div>
                <div><Label>Billed Amount</Label><p className="font-medium">${selectedClaim.billedAmount.toLocaleString()}</p></div>
                <div><Label>Paid by Plan</Label><p className="font-medium">${selectedClaim.paidAmount.toLocaleString()}</p></div>
                <div><Label>Your Responsibility</Label><p className="font-medium text-red-600">${selectedClaim.yourResponsibility.toLocaleString()}</p></div>
                <div><Label>Status</Label><Badge className={getStatusColor(selectedClaim.status)}>{selectedClaim.status}</Badge></div>
              </div>
              <div><Label>Details</Label><p>{selectedClaim.details}</p></div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default App;

