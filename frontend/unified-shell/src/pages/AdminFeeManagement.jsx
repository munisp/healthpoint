import React, { useState, useEffect } from 'react';
import { Edit, PlusCircle, Settings, Loader2, AlertCircle } from 'lucide-react';
import { authFetch } from '../auth/keycloak.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

const AdminFeeManagement = () => {
  const [activeTab, setActiveTab] = useState('feeMethods');
  const [feeMethods, setFeeMethods] = useState([]);
  const [insurancePlans, setInsurancePlans] = useState([]);
  const [discountTiers, setDiscountTiers] = useState([]);
  const [adminSettings, setAdminSettings] = useState({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        let data;
        switch (activeTab) {
          case 'feeMethods':
            data = await authFetch(`${API_BASE}/admin/fees`);
            setFeeMethods(data);
            break;
          case 'insurancePlans':
            data = await authFetch(`${API_BASE}/admin/plans`);
            setInsurancePlans(data);
            break;
          case 'discountTiers':
            data = await authFetch(`${API_BASE}/admin/discounts`);
            setDiscountTiers(data);
            break;
          default:
            break;
        }
        // Fetch settings once, or on every tab change if they are dynamic
        const settingsData = await authFetch(`${API_BASE}/admin/settings`);
        setAdminSettings(settingsData);

      } catch (err) {
        setError('Failed to fetch data: ' + err.message);
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [activeTab]);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="ml-4 text-lg text-gray-600">Loading data...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center p-8 text-red-600 bg-red-50 rounded-lg">
          <AlertCircle className="h-10 w-10 mb-4" />
          <p className="text-xl font-semibold">Error:</p>
          <p className="text-center">{error}</p>
          <p className="text-sm text-gray-500 mt-2">Please try again later or contact support.</p>
        </div>
      );
    }

    switch (activeTab) {
      case 'feeMethods':
        return (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-semibold text-gray-800">Fee Methods</h2>
              <button className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                <PlusCircle className="h-5 w-5 mr-2" />
                Add Fee Method
              </button>
            </div>
            {feeMethods.length === 0 ? (
              <div className="text-center p-8 text-gray-500">
                <p className="text-lg">No fee methods found.</p>
                <p className="text-sm">Click 'Add Fee Method' to create a new one.</p>
              </div>
            ) : (
              <div className="overflow-x-auto bg-white rounded-lg shadow">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method Name</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Base Rate</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Percentage</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Effective Date</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th scope="col" className="relative px-6 py-3"><span className="sr-only">Edit</span></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {feeMethods.map((method) => (
                      <tr key={method.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{method.methodName}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{method.baseRate ? `$${method.baseRate.toFixed(2)}` : 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{method.percentage ? `${method.percentage}%` : 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(method.effectiveDate).toLocaleDateString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${method.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {method.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button className="text-blue-600 hover:text-blue-900">
                            <Edit className="h-5 w-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      case 'insurancePlans':
        return (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-semibold text-gray-800">Insurance Plans</h2>
              <button className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                <PlusCircle className="h-5 w-5 mr-2" />
                Add Insurance Plan
              </button>
            </div>
            {insurancePlans.length === 0 ? (
              <div className="text-center p-8 text-gray-500">
                <p className="text-lg">No insurance plans found.</p>
                <p className="text-sm">Click 'Add Insurance Plan' to create a new one.</p>
              </div>
            ) : (
              <div className="overflow-x-auto bg-white rounded-lg shadow">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan Name</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan Type</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deductible</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">OOP Max</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Premium</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Network Type</th>
                      <th scope="col" className="relative px-6 py-3"><span className="sr-only">Edit</span></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {insurancePlans.map((plan) => (
                      <tr key={plan.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{plan.planName}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.planType}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.deductible ? `$${plan.deductible.toFixed(2)}` : 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.oopMax ? `$${plan.oopMax.toFixed(2)}` : 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.premium ? `$${plan.premium.toFixed(2)}` : 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{plan.networkType}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button className="text-blue-600 hover:text-blue-900">
                            <Edit className="h-5 w-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      case 'discountTiers':
        return (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-semibold text-gray-800">Discount Tiers</h2>
              <button className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                <PlusCircle className="h-5 w-5 mr-2" />
                Add Discount Tier
              </button>
            </div>
            {discountTiers.length === 0 ? (
              <div className="text-center p-8 text-gray-500">
                <p className="text-lg">No discount tiers found.</p>
                <p className="text-sm">Click 'Add Discount Tier' to create a new one.</p>
              </div>
            ) : (
              <div className="overflow-x-auto bg-white rounded-lg shadow">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tier Name</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Min Volume</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Discount %</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Eligibility Criteria</th>
                      <th scope="col" className="relative px-6 py-3"><span className="sr-only">Edit</span></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {discountTiers.map((tier) => (
                      <tr key={tier.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{tier.tierName}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{tier.minVolume}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{tier.discountPercentage ? `${tier.discountPercentage}%` : 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{tier.eligibilityCriteria}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button className="text-blue-600 hover:text-blue-900">
                            <Edit className="h-5 w-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Admin Fee Management</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex border-b border-gray-200 mb-4">
          <button
            className={`py-2 px-4 text-sm font-medium ${activeTab === 'feeMethods' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('feeMethods')}
          >
            Fee Methods
          </button>
          <button
            className={`py-2 px-4 text-sm font-medium ${activeTab === 'insurancePlans' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('insurancePlans')}
          >
            Insurance Plans
          </button>
          <button
            className={`py-2 px-4 text-sm font-medium ${activeTab === 'discountTiers' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('discountTiers')}
          >
            Discount Tiers
          </button>
        </div>
        {renderContent()}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-semibold text-gray-800">Admin Fee Settings</h2>
          <button className="text-blue-600 hover:text-blue-900">
            <Edit className="h-5 w-5" />
          </button>
        </div>
        {loading && Object.keys(adminSettings).length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            <p className="ml-2 text-gray-600">Loading settings...</p>
          </div>
        ) : error && Object.keys(adminSettings).length === 0 ? (
          <div className="flex items-center justify-center p-4 text-red-600">
            <AlertCircle className="h-6 w-6 mr-2" />
            <p>Failed to load settings.</p>
          </div>
        ) : Object.keys(adminSettings).length === 0 ? (
          <div className="text-center p-4 text-gray-500">
            <p>No admin settings found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(adminSettings).map(([key, value]) => (
              <div key={key} className="bg-gray-50 p-3 rounded-md">
                <p className="text-sm font-medium text-gray-500">{key.split(/(?=[A-Z])/).join(' ').replace(/^./, str => str.toUpperCase())}</p>
                <p className="text-lg font-semibold text-gray-900">{String(value)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminFeeManagement;
