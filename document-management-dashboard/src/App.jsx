
import { useState, useEffect } from 'react';
import { 
  File, 
  Folder, 
  Search, 
  Plus, 
  Upload, 
  Download, 
  Edit, 
  Trash2, 
  Share2, 
  MoreVertical, 
  List, 
  Grid 
} from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Badge } from '@/components/ui/badge.jsx';

export default function DocumentManagementDashboard() {
  const [view, setView] = useState('grid');

  // Mock data for Document Management
  const [documentData, setDocumentData] = useState({
    files: [
      { id: 'DOC-001', name: 'Claim_CLM-001.pdf', type: 'pdf', size: '1.2 MB', lastModified: '2024-10-08' },
      { id: 'DOC-002', name: 'Patient_Record_JS.docx', type: 'docx', size: '345 KB', lastModified: '2024-10-07' },
      { id: 'DOC-003', name: 'Provider_Agreement_GH.pdf', type: 'pdf', size: '2.5 MB', lastModified: '2024-10-05' },
    ],
    folders: [
      { id: 'FLDR-001', name: 'Claims Documents' },
      { id: 'FLDR-002', name: 'Patient Records' },
      { id: 'FLDR-003', name: 'Provider Contracts' },
    ],
  });

  const getFileIcon = (type) => {
    switch (type) {
      case 'pdf':
        return <File className="h-12 w-12 text-red-500" />;
      case 'docx':
        return <File className="h-12 w-12 text-blue-500" />;
      default:
        return <File className="h-12 w-12 text-gray-500" />;
    }
  };

  const renderGridView = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {documentData.folders.map((folder) => (
        <Card key={folder.id} className="cursor-pointer hover:shadow-lg transition-shadow">
          <CardContent className="p-6 flex flex-col items-center justify-center">
            <Folder className="h-16 w-16 text-yellow-500" />
            <p className="mt-2 font-semibold">{folder.name}</p>
          </CardContent>
        </Card>
      ))}
      {documentData.files.map((file) => (
        <Card key={file.id} className="cursor-pointer hover:shadow-lg transition-shadow">
          <CardContent className="p-6 flex flex-col items-center justify-center">
            {getFileIcon(file.type)}
            <p className="mt-2 font-semibold truncate w-full text-center">{file.name}</p>
            <p className="text-sm text-muted-foreground">{file.size}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  const renderListView = () => (
    <div className="space-y-2">
      {documentData.folders.map((folder) => (
        <Card key={folder.id} className="cursor-pointer hover:shadow-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Folder className="h-8 w-8 text-yellow-500" />
              <p className="font-semibold">{folder.name}</p>
            </div>
            <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
          </CardContent>
        </Card>
      ))}
      {documentData.files.map((file) => (
        <Card key={file.id} className="cursor-pointer hover:shadow-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {getFileIcon(file.type)}
              <div>
                <p className="font-semibold">{file.name}</p>
                <p className="text-sm text-muted-foreground">{file.size} - Modified: {file.lastModified}</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Button variant="ghost" size="icon"><Download className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon"><Share2 className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon"><Trash2 className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Document Management</h1>
        <div className="flex items-center space-x-2">
          <Button variant="outline"><Upload className="mr-2 h-4 w-4" /> Upload</Button>
          <Button><Plus className="mr-2 h-4 w-4" /> New Folder</Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Input placeholder="Search documents..." className="max-w-sm" />
        <div className="flex items-center space-x-2">
          <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="icon" onClick={() => setView('list')}><List className="h-4 w-4" /></Button>
          <Button variant={view === 'grid' ? 'secondary' : 'ghost'} size="icon" onClick={() => setView('grid')}><Grid className="h-4 w-4" /></Button>
        </div>
      </div>

      {view === 'grid' ? renderGridView() : renderListView()}
    </div>
  );
}

