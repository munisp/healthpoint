import { useState, useEffect } from 'react'
import { 
  Users, 
  User, 
  Search, 
  Filter, 
  Plus, 
  Edit, 
  Eye, 
  Trash2, 
  Download, 
  Upload, 
  RefreshCw,
  Calendar,
  Phone,
  Mail,
  MapPin,
  FileText,
  Heart,
  Activity,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  Star,
  TrendingUp,
  BarChart3,
  PieChart,
  Settings,
  Bell,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  UserPlus,
  UserCheck,
  UserX,
  Shield,
  Database,
  Stethoscope,
  Pill,
  Clipboard,
  CreditCard,
  Building,
  Home
} from 'lucide-react'
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
} from 'recharts'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx'
import { ScrollArea } from '@/components/ui/scroll-area.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Switch } from '@/components/ui/switch.jsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Textarea } from '@/components/ui/textarea.jsx'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('overview')
  const [darkMode, setDarkMode] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [showAddPatient, setShowAddPatient] = useState(false)

  // Mock data for Patient Management
  const [patientData, setPatientData] = useState({
    overview: {
      totalPatients: 45678,
      activePatients: 42341,
      newPatientsToday: 23,
      averageAge: 42.5,
      criticalCases: 156,
      pendingApprovals: 89,
      satisfactionScore: 4.7,
      totalVisits: 125847
    },
    patients: [
      {
        id: 'PT-001',
        name: 'John Smith',
        age: 45,
        gender: 'Male',
        phone: '+1 (555) 123-4567',
        email: 'john.smith@email.com',
        address: '123 Main St, New York, NY 10001',
        insurance: 'Blue Cross Blue Shield',
        primaryProvider: 'Dr. Sarah Johnson',
        lastVisit: '2024-10-05',
        status: 'active',
        riskLevel: 'low',
        conditions: ['Hypertension', 'Diabetes Type 2'],
        medications: ['Metformin', 'Lisinopril'],
        allergies: ['Penicillin'],
        emergencyContact: 'Jane Smith - (555) 123-4568',
        totalClaims: 12,
        totalCost: 15750.00,
        satisfaction: 4.8
      },
      {
        id: 'PT-002',
        name: 'Sarah Davis',
        age: 32,
        gender: 'Female',
        phone: '+1 (555) 234-5678',
        email: 'sarah.davis@email.com',
        address: '456 Oak Ave, Los Angeles, CA 90210',
        insurance: 'Aetna',
        primaryProvider: 'Dr. Michael Brown',
        lastVisit: '2024-10-07',
        status: 'active',
        riskLevel: 'medium',
        conditions: ['Asthma', 'Anxiety'],
        medications: ['Albuterol', 'Sertraline'],
        allergies: ['Shellfish'],
        emergencyContact: 'Robert Davis - (555) 234-5679',
        totalClaims: 8,
        totalCost: 8920.00,
        satisfaction: 4.5
      },
      {
        id: 'PT-003',
        name: 'Robert Wilson',
        age: 67,
        gender: 'Male',
        phone: '+1 (555) 345-6789',
        email: 'robert.wilson@email.com',
        address: '789 Pine St, Chicago, IL 60601',
        insurance: 'Medicare',
        primaryProvider: 'Dr. Emily Chen',
        lastVisit: '2024-10-08',
        status: 'critical',
        riskLevel: 'high',
        conditions: ['Heart Disease', 'COPD', 'Diabetes Type 2'],
        medications: ['Atorvastatin', 'Metformin', 'Spiriva'],
        allergies: ['Sulfa drugs'],
        emergencyContact: 'Mary Wilson - (555) 345-6780',
        totalClaims: 25,
        totalCost: 45230.00,
        satisfaction: 4.9
      }
    ],
    chartData: {
      patientGrowth: [
        { month: 'Jan', patients: 41200, newPatients: 1200, activePatients: 39800 },
        { month: 'Feb', patients: 42100, newPatients: 1350, activePatients: 40650 },
        { month: 'Mar', patients: 42800, newPatients: 1180, activePatients: 41320 },
        { month: 'Apr', patients: 43600, newPatients: 1420, activePatients: 42080 },
        { month: 'May', patients: 44500, newPatients: 1580, activePatients: 42920 },
        { month: 'Jun', patients: 45678, newPatients: 1650, activePatients: 43028 }
      ],
      ageDistribution: [
        { ageGroup: '0-18', count: 5678, percentage: 12.4 },
        { ageGroup: '19-35', count: 12456, percentage: 27.3 },
        { ageGroup: '36-50', count: 15234, percentage: 33.4 },
        { ageGroup: '51-65', count: 8901, percentage: 19.5 },
        { ageGroup: '65+', count: 3409, percentage: 7.4 }
      ],
      conditionBreakdown: [
        { condition: 'Hypertension', count: 8945, color: '#ef4444' },
        { condition: 'Diabetes', count: 6723, color: '#f97316' },
        { condition: 'Heart Disease', count: 4521, color: '#eab308' },
        { condition: 'Asthma', count: 3456, color: '#22c55e' },
        { condition: 'Mental Health', count: 2890, color: '#3b82f6' },
        { condition: 'Other', count: 5234, color: '#8b5cf6' }
      ],
      satisfactionTrends: [
        { month: 'Jan', score: 4.2 },
        { month: 'Feb', score: 4.3 },
        { month: 'Mar', score: 4.4 },
        { month: 'Apr', score: 4.5 },
        { month: 'May', score: 4.6 },
        { month: 'Jun', score: 4.7 }
      ]
    }
  })

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-500'
      case 'inactive': return 'bg-gray-500'
      case 'critical': return 'bg-red-500'
      case 'pending': return 'bg-yellow-500'
      default: return 'bg-gray-500'
    }
  }

  const getRiskColor = (risk) => {
    switch (risk) {
      case 'low': return 'text-green-600 bg-green-50'
      case 'medium': return 'text-yellow-600 bg-yellow-50'
      case 'high': return 'text-red-600 bg-red-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const filteredPatients = patientData.patients.filter(patient =>
    patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.primaryProvider.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{patientData.overview.totalPatients.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +15.3% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Patients</CardTitle>
            <UserCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{patientData.overview.activePatients.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +12.8% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Cases</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{patientData.overview.criticalCases}</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              -8.2% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Satisfaction Score</CardTitle>
            <Star className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{patientData.overview.satisfactionScore}/5</div>
            <p className="text-xs text-muted-foreground">
              <TrendingUp className="inline h-3 w-3 mr-1" />
              +0.3 from last month
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Patient Growth Trends</CardTitle>
            <CardDescription>Monthly patient registration and activity</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={patientData.chartData.patientGrowth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="patients" stackId="1" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
                <Area type="monotone" dataKey="activePatients" stackId="2" stroke="#82ca9d" fill="#82ca9d" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Age Distribution</CardTitle>
            <CardDescription>Patient demographics by age group</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={patientData.chartData.ageDistribution}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ageGroup" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Condition Breakdown and Satisfaction */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Common Conditions</CardTitle>
            <CardDescription>Most frequent patient conditions</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={patientData.chartData.conditionBreakdown}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="count"
                  label={({ condition, count }) => `${condition}: ${count}`}
                >
                  {patientData.chartData.conditionBreakdown.map((entry, index) => (
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
            <CardTitle>Patient Satisfaction Trends</CardTitle>
            <CardDescription>Monthly satisfaction score trends</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={patientData.chartData.satisfactionTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis domain={[0, 5]} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#8884d8" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )

  const renderPatientList = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Patient Directory</h2>
        <div className="flex space-x-2">
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Dialog open={showAddPatient} onOpenChange={setShowAddPatient}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Patient
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add New Patient</DialogTitle>
                <DialogDescription>Enter patient information to create a new record</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Full Name</Label>
                  <Input id="name" placeholder="Enter full name" />
                </div>
                <div>
                  <Label htmlFor="age">Age</Label>
                  <Input id="age" type="number" placeholder="Enter age" />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" placeholder="Enter phone number" />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="Enter email" />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="address">Address</Label>
                  <Textarea id="address" placeholder="Enter full address" />
                </div>
                <div>
                  <Label htmlFor="insurance">Insurance</Label>
                  <Input id="insurance" placeholder="Insurance provider" />
                </div>
                <div>
                  <Label htmlFor="provider">Primary Provider</Label>
                  <Input id="provider" placeholder="Primary care provider" />
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-4">
                <Button variant="outline" onClick={() => setShowAddPatient(false)}>Cancel</Button>
                <Button onClick={() => setShowAddPatient(false)}>Add Patient</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search patients by name, ID, or provider..."
          className="pl-10"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredPatients.map((patient) => (
          <Card key={patient.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedPatient(patient)}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-4">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback>{patient.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold">{patient.name}</h3>
                      <Badge variant="outline" className="font-mono">{patient.id}</Badge>
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(patient.status)}`} />
                      <span className="text-sm text-muted-foreground capitalize">{patient.status}</span>
                      <div className={`px-2 py-1 rounded-full text-xs font-medium ${getRiskColor(patient.riskLevel)}`}>
                        {patient.riskLevel} risk
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                      <div className="flex items-center space-x-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{patient.age}y, {patient.gender}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{patient.phone}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Stethoscope className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{patient.primaryProvider}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Last visit: {patient.lastVisit}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="text-sm">
                          <span className="font-medium">Conditions: </span>
                          <span className="text-muted-foreground">{patient.conditions.join(', ')}</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Star className="h-4 w-4 text-yellow-500" />
                        <span className="text-sm font-medium">{patient.satisfaction}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex space-x-2">
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )

  const renderPatientDetail = () => {
    if (!selectedPatient) return null

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Button variant="outline" size="sm" onClick={() => setSelectedPatient(null)}>
              ← Back to List
            </Button>
            <h2 className="text-2xl font-bold">{selectedPatient.name}</h2>
            <Badge variant="outline" className="font-mono">{selectedPatient.id}</Badge>
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" size="sm">
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Patient Information */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Patient Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">Personal Details</Label>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center space-x-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedPatient.age} years old, {selectedPatient.gender}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedPatient.phone}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedPatient.email}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedPatient.address}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Medical Information</Label>
                    <div className="mt-2 space-y-2">
                      <div>
                        <span className="text-sm font-medium">Conditions: </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedPatient.conditions.map((condition, index) => (
                            <Badge key={index} variant="secondary">{condition}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-sm font-medium">Medications: </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedPatient.medications.map((medication, index) => (
                            <Badge key={index} variant="outline">{medication}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-sm font-medium">Allergies: </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedPatient.allergies.map((allergy, index) => (
                            <Badge key={index} variant="destructive">{allergy}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">Insurance & Provider</Label>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center space-x-2">
                        <Shield className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedPatient.insurance}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Stethoscope className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedPatient.primaryProvider}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>Last visit: {selectedPatient.lastVisit}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Emergency Contact</Label>
                    <div className="mt-2">
                      <div className="flex items-center space-x-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span>{selectedPatient.emergencyContact}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Financial Summary</Label>
                    <div className="mt-2 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm">Total Claims:</span>
                        <span className="font-medium">{selectedPatient.totalClaims}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Total Cost:</span>
                        <span className="font-medium">${selectedPatient.totalCost.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm">Satisfaction:</span>
                        <div className="flex items-center space-x-1">
                          <Star className="h-4 w-4 text-yellow-500" />
                          <span className="font-medium">{selectedPatient.satisfaction}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full justify-start">
                <Calendar className="h-4 w-4 mr-2" />
                Schedule Appointment
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <FileText className="h-4 w-4 mr-2" />
                View Medical Records
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <CreditCard className="h-4 w-4 mr-2" />
                View Claims History
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <Mail className="h-4 w-4 mr-2" />
                Send Message
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <Pill className="h-4 w-4 mr-2" />
                Prescribe Medication
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <Clipboard className="h-4 w-4 mr-2" />
                Add Notes
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen bg-background ${darkMode ? 'dark' : ''}`}>
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-16 items-center px-4">
          <div className="flex items-center space-x-4">
            <Users className="h-6 w-6 text-blue-500" />
            <h1 className="text-xl font-bold">Patient Management Dashboard</h1>
          </div>

          <div className="flex-1 flex items-center justify-center px-8">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search patients..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="sm" onClick={() => setDarkMode(!darkMode)}>
              {darkMode ? '☀️' : '🌙'}
            </Button>
            <Button variant="ghost" size="sm">
              <Bell className="h-5 w-5" />
            </Button>
            <Avatar>
              <AvatarFallback>PM</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6">
        {selectedPatient ? (
          renderPatientDetail()
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="patients">Patient Directory</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              {renderOverview()}
            </TabsContent>

            <TabsContent value="patients">
              {renderPatientList()}
            </TabsContent>

            <TabsContent value="analytics">
              {renderOverview()}
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  )
}

export default App
