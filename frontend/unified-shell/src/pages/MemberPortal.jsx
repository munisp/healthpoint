import React, { useState, useEffect } from 'react';
import { User, Award, CheckCircle, Hourglass, BookOpen, GraduationCap, TrendingUp } from 'lucide-react';
import { authFetch } from '../auth/keycloak.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

const MemberPortal = () => {
  // In a real application, userId would come from the auth context (e.g., Keycloak token)
  // For this example, we'll use a placeholder. Assume a mechanism to get the current user's ID.
  const userId = 'current-user-id'; // Placeholder: Replace with actual user ID from auth context

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('enrollments');

  const [enrollments, setEnrollments] = useState([]);
  const [certifications, setCertifications] = useState([]);
  const [progressData, setProgressData] = useState([]);

  const [kpiData, setKpiData] = useState({
    activeEnrollments: 0,
    completedTrainings: 0,
    certificationsEarned: 0,
    pendingItems: 0,
  });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch Enrollments
        const enrollmentsResponse = await authFetch(`${API_BASE}/users/${userId}/enrollments`);
        if (!enrollmentsResponse.ok) throw new Error(`HTTP error! status: ${enrollmentsResponse.status}`);
        const enrollmentsData = await enrollmentsResponse.json();
        setEnrollments(enrollmentsData);

        // Fetch Certifications
        const certificationsResponse = await authFetch(`${API_BASE}/users/${userId}/certificates`);
        if (!certificationsResponse.ok) throw new Error(`HTTP error! status: ${certificationsResponse.status}`);
        const certificationsData = await certificationsResponse.json();
        setCertifications(certificationsData);

        // Fetch Progress
        const progressResponse = await authFetch(`${API_BASE}/users/${userId}/progress`);
        if (!progressResponse.ok) throw new Error(`HTTP error! status: ${progressResponse.status}`);
        const progressJson = await progressResponse.json();
        setProgressData(progressJson);

        // Calculate KPI data
        const activeEnrollmentsCount = enrollmentsData.filter(e => e.status === 'Active').length;
        const completedTrainingsCount = enrollmentsData.filter(e => e.progress === 100).length;
        const certificationsEarnedCount = certificationsData.length;
        // Assuming 'Pending' status for enrollments or certifications for pending items
        const pendingItemsCount = enrollmentsData.filter(e => e.status === 'Pending').length + 
                                  certificationsData.filter(c => c.status === 'Pending').length;

        setKpiData({
          activeEnrollments: activeEnrollmentsCount,
          completedTrainings: completedTrainingsCount,
          certificationsEarned: certificationsEarnedCount,
          pendingItems: pendingItemsCount,
        });

      } catch (err) {
        console.error("Failed to fetch member portal data:", err);
        setError('Failed to load data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    if (userId !== 'current-user-id') { // Only fetch if userId is not the placeholder
      fetchData();
    }
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-lg font-semibold text-gray-700">Loading member data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-red-600 text-lg font-semibold">Error: {error}</div>
      </div>
    );
  }

  const renderEmptyState = (message) => (
    <div className="text-center py-8 text-gray-500">
      <p className="text-lg">{message}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Member Portal</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-md p-6 flex items-center space-x-4">
          <BookOpen className="text-blue-500" size={28} />
          <div>
            <p className="text-gray-500 text-sm">Active Enrollments</p>
            <p className="text-2xl font-semibold text-gray-800">{kpiData.activeEnrollments}</p>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-6 flex items-center space-x-4">
          <CheckCircle className="text-green-500" size={28} />
          <div>
            <p className="text-gray-500 text-sm">Completed Trainings</p>
            <p className="text-2xl font-semibold text-gray-800">{kpiData.completedTrainings}</p>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-6 flex items-center space-x-4">
          <Award className="text-yellow-500" size={28} />
          <div>
            <p className="text-gray-500 text-sm">Certifications Earned</p>
            <p className="text-2xl font-semibold text-gray-800">{kpiData.certificationsEarned}</p>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-6 flex items-center space-x-4">
          <Hourglass className="text-orange-500" size={28} />
          <div>
            <p className="text-gray-500 text-sm">Pending Items</p>
            <p className="text-2xl font-semibold text-gray-800">{kpiData.pendingItems}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="border-b border-gray-200 mb-4">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('enrollments')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm 
                ${activeTab === 'enrollments' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              Enrollments
            </button>
            <button
              onClick={() => setActiveTab('certifications')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm 
                ${activeTab === 'certifications' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              Certifications
            </button>
            <button
              onClick={() => setActiveTab('progress')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm 
                ${activeTab === 'progress' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              Progress Tracker
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'enrollments' && (
            <div>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">My Enrollments</h2>
              {enrollments.length === 0 ? renderEmptyState('No active enrollments found.') : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Enrollment ID</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Program Name</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Start Date</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">End Date</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress (%)</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {enrollments.map((enrollment) => (
                        <tr key={enrollment.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{enrollment.id}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{enrollment.programName}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(enrollment.startDate).toLocaleDateString()}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(enrollment.endDate).toLocaleDateString()}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                              ${enrollment.status === 'Active' ? 'bg-green-100 text-green-800' :
                                enrollment.status === 'Completed' ? 'bg-blue-100 text-blue-800' :
                                'bg-gray-100 text-gray-800'}`}>
                              {enrollment.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{enrollment.progress}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'certifications' && (
            <div>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">My Certifications</h2>
              {certifications.length === 0 ? renderEmptyState('No certifications found.') : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cert Name</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Issued Date</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expiry Date</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {certifications.map((cert) => (
                        <tr key={cert.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{cert.certName}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(cert.issuedDate).toLocaleDateString()}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(cert.expiryDate).toLocaleDateString()}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                              ${cert.status === 'Valid' ? 'bg-green-100 text-green-800' :
                                cert.status === 'Expired' ? 'bg-red-100 text-red-800' :
                                'bg-gray-100 text-gray-800'}`}>
                              {cert.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'progress' && (
            <div>
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Program Progress Tracker</h2>
              {progressData.length === 0 ? renderEmptyState('No progress data available.') : (
                <div className="space-y-6">
                  {progressData.map((program) => (
                    <div key={program.programId} className="bg-gray-50 p-4 rounded-lg shadow-sm">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="text-lg font-medium text-gray-900">{program.programName}</h3>
                        <span className="text-sm font-semibold text-blue-600">{program.completionPercentage}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div 
                          className="bg-blue-600 h-2.5 rounded-full"
                          style={{ width: `${program.completionPercentage}%` }}
                          role="progressbar"
                          aria-valuenow={program.completionPercentage}
                          aria-valuemin="0"
                          aria-valuemax="100"
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MemberPortal;
