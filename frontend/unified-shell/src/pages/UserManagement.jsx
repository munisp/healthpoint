import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserCheck, UserPlus, UserX, Search, Filter, ChevronLeft, ChevronRight, Edit, Trash2, Lock, Plus } from 'lucide-react';
import { authFetch } from '../auth/keycloak.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://api.healthpoint.gov';

const roleColors = {
  super_admin: 'bg-red-100 text-red-800',
  admin: 'bg-purple-100 text-purple-800',
  provider_admin: 'bg-indigo-100 text-indigo-800',
  payer: 'bg-blue-100 text-blue-800',
  idr_entity: 'bg-green-100 text-green-800',
  aggregator: 'bg-yellow-100 text-yellow-800',
  member: 'bg-gray-100 text-gray-800',
  auditor: 'bg-teal-100 text-teal-800',
};

const statusColors = {
  Active: 'bg-green-100 text-green-800',
  Inactive: 'bg-red-100 text-red-800',
  Pending: 'bg-yellow-100 text-yellow-800',
};

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kpi, setKpi] = useState({
    totalUsers: 0,
    activeUsers: 0,
    pendingInvitations: 0,
    adminUsers: 0,
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({
    role: '',
    status: '',
    search: '',
  });
  const [showEditRoleModal, setShowEditRoleModal] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [newRole, setNewRole] = useState('');
  const [isActionLoading, setIsActionLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({
        page: currentPage,
        limit: 10, // Assuming 10 items per page
        ...(filters.role && { role: filters.role }),
        ...(filters.status && { status: filters.status }),
        ...(filters.search && { search: filters.search }),
      }).toString();
      const response = await authFetch(`${API_BASE}/users?${queryParams}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setUsers(data.users || []);
      setTotalPages(data.totalPages || 1);
      setKpi({
        totalUsers: data.totalUsers || 0,
        activeUsers: data.activeUsers || 0,
        pendingInvitations: data.pendingInvitations || 0,
        adminUsers: data.adminUsers || 0,
      });
    } catch (e) {
      console.error('Failed to fetch users:', e);
      setError('Failed to load users. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentPage, filters]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
    setCurrentPage(1); // Reset to first page on filter change
  };

  const handlePageChange = (newPage) => {
    if (newPage > 0 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleEditRole = async () => {
    if (!selectedUser || !newRole) return;
    setIsActionLoading(true);
    try {
      const response = await authFetch(`${API_BASE}/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
      setShowEditRoleModal(false);
      setSelectedUser(null);
      setNewRole('');
      fetchUsers(); // Refresh data
    } catch (e) {
      console.error('Failed to update user role:', e);
      setError('Failed to update user role. Please try again.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDeactivate = async () => {
    if (!selectedUser) return;
    setIsActionLoading(true);
    try {
      // Assuming PUT /users/{id} can also handle status updates
      const response = await authFetch(`${API_BASE}/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Inactive' }), // Or a specific deactivate endpoint if available
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
      setShowDeactivateModal(false);
      setSelectedUser(null);
      fetchUsers(); // Refresh data
    } catch (e) {
      console.error('Failed to deactivate user:', e);
      setError('Failed to deactivate user. Please try again.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;
    setIsActionLoading(true);
    try {
      // Assuming a PUT /users/{id} endpoint can trigger a password reset or there's a dedicated one
      // For this example, we'll simulate a call that might trigger an email or set a temporary password
      const response = await authFetch(`${API_BASE}/users/${selectedUser.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ /* payload for reset password, e.g., sendEmail: true */ }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
      setShowResetPasswordModal(false);
      setSelectedUser(null);
      alert('Password reset initiated. User will receive an email.');
    } catch (e) {
      console.error('Failed to reset password:', e);
      setError('Failed to reset password. Please try again.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleAddUser = async () => {
    // In a real application, this would open a form/modal for adding a new user
    // For now, we'll just log a message.
    alert('Add User functionality would be implemented here.');
    // Example API call for adding a user (POST /users)
    /*
    try {
      const response = await authFetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New User', email: 'new@example.com', role: 'member' }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
      fetchUsers();
    } catch (e) {
      console.error('Failed to add user:', e);
      setError('Failed to add user. Please try again.');
    }
    */
  };

  const openEditRoleModal = (user) => {
    setSelectedUser(user);
    setNewRole(user.role);
    setShowEditRoleModal(true);
  };

  const openDeactivateModal = (user) => {
    setSelectedUser(user);
    setShowDeactivateModal(true);
  };

  const openResetPasswordModal = (user) => {
    setSelectedUser(user);
    setShowResetPasswordModal(true);
  };

  const allRoles = Object.keys(roleColors);
  const allStatuses = Object.keys(statusColors);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">User Management</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-5 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Total Users</p>
            <p className="text-2xl font-semibold text-gray-900">{kpi.totalUsers}</p>
          </div>
          <Users className="text-blue-500" size={28} />
        </div>
        <div className="bg-white p-5 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Active Users</p>
            <p className="text-2xl font-semibold text-gray-900">{kpi.activeUsers}</p>
          </div>
          <UserCheck className="text-green-500" size={28} />
        </div>
        <div className="bg-white p-5 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Pending Invitations</p>
            <p className="text-2xl font-semibold text-gray-900">{kpi.pendingInvitations}</p>
          </div>
          <UserPlus className="text-yellow-500" size={28} />
        </div>
        <div className="bg-white p-5 rounded-lg shadow flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">Admin Users</p>
            <p className="text-2xl font-semibold text-gray-900">{kpi.adminUsers}</p>
          </div>
          <UserX className="text-red-500" size={28} />
        </div>
      </div>

      {/* Filters and Add User */}
      <div className="bg-white p-6 rounded-lg shadow mb-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex-grow flex flex-col md:flex-row gap-4 w-full">
            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                name="search"
                placeholder="Search by Name or Email..."
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-md w-full focus:ring-blue-500 focus:border-blue-500"
                value={filters.search}
                onChange={handleFilterChange}
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <select
                name="role"
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-md w-full md:w-48 focus:ring-blue-500 focus:border-blue-500 appearance-none"
                value={filters.role}
                onChange={handleFilterChange}
              >
                <option value="">All Roles</option>
                {allRoles.map((role) => (
                  <option key={role} value={role}>
                    {role.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <select
                name="status"
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-md w-full md:w-48 focus:ring-blue-500 focus:border-blue-500 appearance-none"
                value={filters.status}
                onChange={handleFilterChange}
              >
                <option value="">All Statuses</option>
                {allStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
            </div>
          </div>
          <button
            onClick={handleAddUser}
            className="bg-blue-600 text-white px-5 py-2 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 w-full md:w-auto flex items-center justify-center gap-2"
          >
            <Plus size={20} /> Add User
          </button>
        </div>
      </div>

      {/* User Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-gray-500">
            Loading users...
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-600">
            {error}
          </div>
        ) : users.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            No users found matching your criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User ID</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Sign In</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{user.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.email}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${roleColors[user.role] || 'bg-gray-100 text-gray-800'}`}>
                        {user.role.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColors[user.status] || 'bg-gray-100 text-gray-800'}`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.lastSignIn ? new Date(user.lastSignIn).toLocaleString() : 'N/A'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => openEditRoleModal(user)}
                          className="text-indigo-600 hover:text-indigo-900 p-1 rounded-full hover:bg-gray-100"
                          title="Edit Role"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => openDeactivateModal(user)}
                          className="text-red-600 hover:text-red-900 p-1 rounded-full hover:bg-gray-100"
                          title="Deactivate User"
                        >
                          <Trash2 size={18} />
                        </button>
                        <button
                          onClick={() => openResetPasswordModal(user)}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded-full hover:bg-gray-100"
                          title="Reset Password"
                        >
                          <Lock size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {users.length > 0 && (
          <nav
            className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6"
            aria-label="Pagination"
          >
            <div className="flex-1 flex justify-between sm:justify-end">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1 || loading}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={18} className="mr-2" /> Previous
              </button>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages || loading}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={18} className="ml-2" />
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Showing <span className="font-medium">{(currentPage - 1) * 10 + 1}</span> to <span className="font-medium">{Math.min(currentPage * 10, kpi.totalUsers)}</span> of{' '}
                  <span className="font-medium">{kpi.totalUsers}</span> results
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                  {/* Simple pagination, can be expanded for more complex page number display */}
                  <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                    Page {currentPage} of {totalPages}
                  </span>
                </nav>
              </div>
            </div>
          </nav>
        )}
      </div>

      {/* Modals */}
      {showEditRoleModal && selectedUser && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex justify-center items-center">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-xl font-semibold mb-4">Edit Role for {selectedUser.name}</h3>
            <div className="mb-4">
              <label htmlFor="role-select" className="block text-sm font-medium text-gray-700 mb-2">Select New Role</label>
              <select
                id="role-select"
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              >
                {allRoles.map((role) => (
                  <option key={role} value={role}>
                    {role.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowEditRoleModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={isActionLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleEditRole}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isActionLoading}
              >
                {isActionLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeactivateModal && selectedUser && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex justify-center items-center">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-xl font-semibold mb-4">Deactivate User</h3>
            <p className="mb-6">Are you sure you want to deactivate user <span className="font-medium">{selectedUser.name}</span>?</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeactivateModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={isActionLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleDeactivate}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isActionLoading}
              >
                {isActionLoading ? 'Deactivating...' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetPasswordModal && selectedUser && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex justify-center items-center">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-xl font-semibold mb-4">Reset Password</h3>
            <p className="mb-6">Are you sure you want to reset the password for <span className="font-medium">{selectedUser.name}</span>? An email will be sent to them with instructions.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowResetPasswordModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={isActionLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleResetPassword}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isActionLoading}
              >
                {isActionLoading ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Add a dummy ChevronDown icon for the select dropdowns, as Lucide-React doesn't have it directly
const ChevronDown = (props) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export default UserManagement;
