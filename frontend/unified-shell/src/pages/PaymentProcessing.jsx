import React, { useState, useEffect, useCallback } from 'react';
import { 
  DollarSign, Clock, XCircle, TrendingUp, 
  Filter, Search, ChevronDown, ChevronUp, 
  Calculator, Eye, RefreshCcw, Ban
} from 'lucide-react';
import { authFetch } from '../auth/keycloak.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

const PaymentProcessing = () => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kpiData, setKpiData] = useState({
    totalSettled: 0,
    pendingPayments: 0,
    failedPayments: 0,
    avgSettlementTime: 0,
  });
  const [filters, setFilters] = useState({
    status: 'All',
    method: 'All',
    page: 1,
    limit: 10,
  });
  const [pagination, setPagination] = useState({
    total: 0,
    currentPage: 1,
    totalPages: 1,
  });
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'ascending' });

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({
        page: filters.page,
        limit: filters.limit,
        ...(filters.status !== 'All' && { status: filters.status }),
        ...(filters.method !== 'All' && { method: filters.method }),
      }).toString();
      const response = await authFetch(`${API_BASE}/payments?${queryParams}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setPayments(data.payments);
      setPagination({
        total: data.total,
        currentPage: data.page,
        totalPages: Math.ceil(data.total / filters.limit),
      });

      // Fetch KPI data separately or derive from payments data if API doesn't provide
      // For now, let's assume a separate KPI endpoint or derive from fetched payments
      const kpiResponse = await authFetch(`${API_BASE}/payments/stats`); // Assuming a stats endpoint
      if (!kpiResponse.ok) {
        throw new Error(`HTTP error! status: ${kpiResponse.status}`);
      }
      const kpiStats = await kpiResponse.json();
      setKpiData({
        totalSettled: kpiStats.totalSettledThisMonth,
        pendingPayments: kpiStats.pendingPayments,
        failedPayments: kpiStats.failedPayments,
        avgSettlementTime: kpiStats.avgSettlementTimeDays,
      });

    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleFilterChange = (e) => {
    setFilters(prev => ({
      ...prev,
      [e.target.name]: e.target.value,
      page: 1, // Reset to first page on filter change
    }));
  };

  const handlePageChange = (newPage) => {
    setFilters(prev => ({
      ...prev,
      page: newPage,
    }));
  };

  const sortedPayments = React.useMemo(() => {
    let sortableItems = [...payments];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        if (a[sortConfig.key] < b[sortConfig.key]) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (a[sortConfig.key] > b[sortConfig.key]) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [payments, sortConfig]);

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const getClassNamesFor = (name) => {
    if (!sortConfig.key) {
      return;
    }
    return sortConfig.key === name ? sortConfig.direction : undefined;
  };

  const handleAction = async (paymentId, actionType) => {
    try {
      let endpoint = '';
      let method = 'POST';
      switch (actionType) {
        case 'reconcile':
          endpoint = `${API_BASE}/payments/${paymentId}/reconcile`;
          break;
        case 'cancel':
          endpoint = `${API_BASE}/payments/${paymentId}/cancel`;
          break;
        case 'late-interest':
          endpoint = `${API_BASE}/payments/${paymentId}/late-interest`;
          break;
        case 'view':
          alert(`Viewing payment ${paymentId}`); // In a real app, this would navigate to a detail page
          return;
        default:
          return;
      }

      const response = await authFetch(endpoint, { method });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      alert(`Payment ${paymentId} ${actionType}d successfully!`);
      fetchPayments(); // Refresh data
    } catch (e) {
      alert(`Error ${actionType}ing payment ${paymentId}: ${e.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-lg font-semibold text-gray-700">Loading payments...</div>
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

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Payment Processing</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <KPICard
          title="Total Settled This Month"
          value={`$${kpiData.totalSettled.toLocaleString()}`}
          icon={<DollarSign className="text-green-500" />}
          description="Payments settled in the current month"
        />
        <KPICard
          title="Pending Payments"
          value={`$${kpiData.pendingPayments.toLocaleString()}`}
          icon={<Clock className="text-yellow-500" />}
          description="Payments awaiting settlement"
        />
        <KPICard
          title="Failed Payments"
          value={kpiData.failedPayments.toLocaleString()}
          icon={<XCircle className="text-red-500" />}
          description="Payments that could not be processed"
        />
        <KPICard
          title="Avg Settlement Time"
          value={`${kpiData.avgSettlementTime} days`}
          icon={<TrendingUp className="text-blue-500" />}
          description="Average time from initiation to settlement"
        />
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-8 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <Filter className="text-gray-500" size={20} />
          <label htmlFor="status-filter" className="text-gray-700 font-medium">Status:</label>
          <select
            id="status-filter"
            name="status"
            value={filters.status}
            onChange={handleFilterChange}
            className="border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="All">All</option>
            <option value="Pending">Pending</option>
            <option value="Processing">Processing</option>
            <option value="Settled">Settled</option>
            <option value="Failed">Failed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="method-filter" className="text-gray-700 font-medium">Method:</label>
          <select
            id="method-filter"
            name="method"
            value={filters.method}
            onChange={handleFilterChange}
            className="border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="All">All</option>
            <option value="ACH">ACH</option>
            <option value="Wire">Wire</option>
            <option value="Check">Check</option>
          </select>
        </div>

        <button
          onClick={fetchPayments}
          className="ml-auto bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center gap-2"
        >
          <RefreshCcw size={18} /> Refresh
        </button>
      </div>

      {/* Payments Table */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        {sortedPayments.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No payments found matching your criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => requestSort('paymentId')}
                  >
                    Payment ID {getClassNamesFor('paymentId') === 'ascending' ? <ChevronUp size={14} className="inline" /> : getClassNamesFor('paymentId') === 'descending' ? <ChevronDown size={14} className="inline" /> : null}
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => requestSort('payee')}
                  >
                    Payee {getClassNamesFor('payee') === 'ascending' ? <ChevronUp size={14} className="inline" /> : getClassNamesFor('payee') === 'descending' ? <ChevronDown size={14} className="inline" /> : null}
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => requestSort('paymentMethod')}
                  >
                    Payment Method {getClassNamesFor('paymentMethod') === 'ascending' ? <ChevronUp size={14} className="inline" /> : getClassNamesFor('paymentMethod') === 'descending' ? <ChevronDown size={14} className="inline" /> : null}
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => requestSort('amount')}
                  >
                    Amount {getClassNamesFor('amount') === 'ascending' ? <ChevronUp size={14} className="inline" /> : getClassNamesFor('amount') === 'descending' ? <ChevronDown size={14} className="inline" /> : null}
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => requestSort('status')}
                  >
                    Status {getClassNamesFor('status') === 'ascending' ? <ChevronUp size={14} className="inline" /> : getClassNamesFor('status') === 'descending' ? <ChevronDown size={14} className="inline" /> : null}
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => requestSort('initiatedDate')}
                  >
                    Initiated Date {getClassNamesFor('initiatedDate') === 'ascending' ? <ChevronUp size={14} className="inline" /> : getClassNamesFor('initiatedDate') === 'descending' ? <ChevronDown size={14} className="inline" /> : null}
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => requestSort('settlementDate')}
                  >
                    Settlement Date {getClassNamesFor('settlementDate') === 'ascending' ? <ChevronUp size={14} className="inline" /> : getClassNamesFor('settlementDate') === 'descending' ? <ChevronDown size={14} className="inline" /> : null}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedPayments.map((payment) => (
                  <tr key={payment.paymentId}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{payment.paymentId}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{payment.payee}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{payment.paymentMethod}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${payment.amount.toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <StatusBadge status={payment.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(payment.initiatedDate).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {payment.settlementDate ? new Date(payment.settlementDate).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleAction(payment.paymentId, 'view')}
                          className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                          title="View Payment Details"
                        >
                          <Eye size={16} /> View
                        </button>
                        {payment.status === 'Pending' && (
                          <>
                            <button
                              onClick={() => handleAction(payment.paymentId, 'reconcile')}
                              className="text-green-600 hover:text-green-900 flex items-center gap-1"
                              title="Reconcile Payment"
                            >
                              <RefreshCcw size={16} /> Reconcile
                            </button>
                            <button
                              onClick={() => handleAction(payment.paymentId, 'cancel')}
                              className="text-red-600 hover:text-red-900 flex items-center gap-1"
                              title="Cancel Payment"
                            >
                              <Ban size={16} /> Cancel
                            </button>
                          </>
                        )}
                        {payment.status === 'Settled' && new Date(payment.settlementDate) < new Date() && (
                          <button
                            onClick={() => handleAction(payment.paymentId, 'late-interest')}
                            className="text-purple-600 hover:text-purple-900 flex items-center gap-1"
                            title="Calculate Late Interest"
                          >
                            <Calculator size={16} /> Late Interest
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex justify-between items-center mt-6">
            <button
              onClick={() => handlePageChange(pagination.currentPage - 1)}
              disabled={pagination.currentPage === 1}
              className="px-4 py-2 border rounded-md text-gray-700 bg-gray-50 hover:bg-gray-100 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-700">
              Page {pagination.currentPage} of {pagination.totalPages}
            </span>
            <button
              onClick={() => handlePageChange(pagination.currentPage + 1)}
              disabled={pagination.currentPage === pagination.totalPages}
              className="px-4 py-2 border rounded-md text-gray-700 bg-gray-50 hover:bg-gray-100 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const KPICard = ({ title, value, icon, description }) => (
  <div className="bg-white p-6 rounded-lg shadow-md flex items-center space-x-4">
    <div className="flex-shrink-0 p-3 rounded-full bg-gray-100">
      {icon}
    </div>
    <div>
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-400 mt-1">{description}</p>
    </div>
  </div>
);

const StatusBadge = ({ status }) => {
  let colorClass = '';
  switch (status) {
    case 'Pending':
      colorClass = 'bg-yellow-100 text-yellow-800';
      break;
    case 'Processing':
      colorClass = 'bg-blue-100 text-blue-800';
      break;
    case 'Settled':
      colorClass = 'bg-green-100 text-green-800';
      break;
    case 'Failed':
      colorClass = 'bg-red-100 text-red-800';
      break;
    case 'Cancelled':
      colorClass = 'bg-gray-100 text-gray-800';
      break;
    default:
      colorClass = 'bg-gray-100 text-gray-800';
  }
  return (
    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${colorClass}`}>
      {status}
    </span>
  );
};

export default PaymentProcessing;
