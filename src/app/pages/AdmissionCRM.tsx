import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { getBranches, getBranchName } from '../lib/branchService';
import {
  applyAdmissionWorkflowAction,
  createAdmission,
  getAdmissionStats,
  getAdmissionStatusColor,
  getAdmissionWorkflowActions,
  getAdmissions,
  getFilteredAdmissions,
  refreshAdmissions,
  subscribeAdmissions,
  type AdmissionRecord,
} from '../lib/admissionService';
import { UserPlus, Users, CheckCircle, Clock, ArrowRight, XCircle, FileCheck2, Plus } from 'lucide-react';
import { WhatsAppButton } from '../components/WhatsAppButton';
import { composeWhatsAppMessage, getWhatsAppBusinessName } from '../lib/whatsapp';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Button } from '../components/ui/button';

const EMPTY_ENQUIRY = { applicantName: '', grade: '10th A', contactNumber: '', email: '', appliedDate: new Date().toISOString().slice(0, 10) };

export function AdmissionCRM() {
  const { user } = useAuth();
  const branches = getBranches();
  const [admissions, setAdmissions] = useState<AdmissionRecord[]>(getAdmissions());
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ENQUIRY);

  useEffect(() => {
    const unsubscribe = subscribeAdmissions(() => setAdmissions(getAdmissions()));
    return unsubscribe;
  }, []);

  useEffect(() => {
    void refreshAdmissions(user?.role === 'super_admin' ? branchFilter || undefined : user?.branchId);
  }, [user?.role, user?.branchId, branchFilter]);

  async function handleCreateEnquiry() {
    if (!addForm.applicantName.trim()) {
      alert('Applicant name is required.');
      return;
    }
    const created = await createAdmission({
      applicantName: addForm.applicantName.trim(),
      grade: addForm.grade,
      contactNumber: addForm.contactNumber,
      email: addForm.email,
      appliedDate: addForm.appliedDate,
      branchId: user?.role === 'super_admin' ? (branchFilter || undefined) : user?.branchId,
    });
    if (created) {
      setAddOpen(false);
      setAddForm(EMPTY_ENQUIRY);
    } else {
      alert('Failed to create enquiry.');
    }
  }

  const filteredAdmissions = useMemo(() => getFilteredAdmissions(admissions, user, branchFilter), [admissions, branchFilter, user]);
  const stats = useMemo(() => getAdmissionStats(filteredAdmissions), [filteredAdmissions]);

  const columns = [
    { header: 'Applicant Name', accessor: 'applicantName' as const },
    { header: 'Grade', accessor: 'grade' as const },
    { header: 'Applied Date', accessor: 'appliedDate' as const },
    { header: 'Contact', accessor: 'contactNumber' as const },
    { header: 'Email', accessor: 'email' as const },
    ...(user?.role === 'super_admin' ? [{ header: 'Branch', accessor: (admission: AdmissionRecord) => getBranchName(admission.branchId) }] : []),
    {
      header: 'Status',
      accessor: (admission: AdmissionRecord) => (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getAdmissionStatusColor(admission.status)}`}>
          {admission.status}
        </span>
      ),
    },
    {
      header: 'WhatsApp',
      accessor: (admission: AdmissionRecord) => (
        <WhatsAppButton
          variant="outline"
          phone={admission.contactNumber}
          label="Chat"
          message={() =>
            composeWhatsAppMessage({
              greeting: admission.applicantName,
              intro: `This is ${getWhatsAppBusinessName()} regarding your admission application.`,
              sections: [
                [
                  { label: 'Grade', value: admission.grade },
                  { label: 'Branch', value: user?.role === 'super_admin' ? getBranchName(admission.branchId) : undefined },
                  { label: 'Status', value: admission.status },
                ],
              ],
              closing: 'Please let us know if you have any questions. Thank you!',
            })
          }
        />
      ),
    },
    {
      header: 'Workflow',
      accessor: (admission: AdmissionRecord) => (
        <div className="flex flex-wrap gap-2">
          {getAdmissionWorkflowActions(admission.status).map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => applyAdmissionWorkflowAction(admission.id, action.action)}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
            >
              {action.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ))}
          {admission.status !== 'Rejected' && admission.status !== 'Enrolled' && (
            <button
              type="button"
              onClick={() => applyAdmissionWorkflowAction(admission.id, 'reject')}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex-1">
      <Header title="Admission CRM" />

      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Admission stages update automatically as the student moves through the workflow.</p>
          <div className="flex items-center gap-3">
            {user?.role === 'super_admin' && (
              <select
                value={branchFilter}
                onChange={(event) => setBranchFilter(event.target.value)}
                className="rounded-lg border border-input bg-card px-3 py-2 text-sm"
              >
                <option value="">All Branches</option>
                {branches.filter((branch) => branch.status === 'Active').map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            )}
            <Button onClick={() => setAddOpen(true)}><Plus className="mr-2 h-4 w-4" />New Enquiry</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Total Applications" value={String(stats.total)} change="Live workflow" changeType="positive" icon={UserPlus} iconColor="bg-primary" />
          <StatsCard title="In Progress" value={String(stats.inProgress)} change="Current stage" changeType="positive" icon={Clock} iconColor="bg-chart-4" />
          <StatsCard title="Approved" value={String(stats.approved)} change="Ready for enrollment" changeType="positive" icon={CheckCircle} iconColor="bg-chart-3" />
          <StatsCard title="Enrolled" value={String(stats.enrolled)} change="Student management updated" changeType="positive" icon={FileCheck2} iconColor="bg-accent" />
        </div>

        <DataTable columns={columns} data={filteredAdmissions} />
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Admission Enquiry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="block text-sm font-medium">Applicant Name</label>
              <input className="w-full border rounded px-2 py-1" value={addForm.applicantName} onChange={(e) => setAddForm((p) => ({ ...p, applicantName: e.target.value }))} placeholder="e.g. Rahul Sharma" />
            </div>
            <div>
              <label className="block text-sm font-medium">Grade / Class</label>
              <input className="w-full border rounded px-2 py-1" value={addForm.grade} onChange={(e) => setAddForm((p) => ({ ...p, grade: e.target.value }))} placeholder="e.g. 10th A" />
            </div>
            <div>
              <label className="block text-sm font-medium">Contact Number</label>
              <input className="w-full border rounded px-2 py-1" value={addForm.contactNumber} onChange={(e) => setAddForm((p) => ({ ...p, contactNumber: e.target.value }))} placeholder="e.g. 9876543210" />
            </div>
            <div>
              <label className="block text-sm font-medium">Email</label>
              <input className="w-full border rounded px-2 py-1" value={addForm.email} onChange={(e) => setAddForm((p) => ({ ...p, email: e.target.value }))} placeholder="e.g. parent@email.com" />
            </div>
            <div>
              <label className="block text-sm font-medium">Applied Date</label>
              <input type="date" className="w-full border rounded px-2 py-1" value={addForm.appliedDate} onChange={(e) => setAddForm((p) => ({ ...p, appliedDate: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateEnquiry}>Create Enquiry</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
