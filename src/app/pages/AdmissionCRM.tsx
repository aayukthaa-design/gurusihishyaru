import { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { StatsCard } from '../components/StatsCard';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../auth/AuthContext';
import { getBranches, getBranchName } from '../lib/branchService';
import {
  applyAdmissionWorkflowAction,
  getAdmissionStats,
  getAdmissionStatusColor,
  getAdmissionWorkflowActions,
  getAdmissions,
  getFilteredAdmissions,
  subscribeAdmissions,
  type AdmissionRecord,
} from '../lib/admissionService';
import { UserPlus, Users, CheckCircle, Clock, ArrowRight, XCircle, FileCheck2 } from 'lucide-react';
import { WhatsAppButton } from '../components/WhatsAppButton';
import { composeWhatsAppMessage, getWhatsAppBusinessName } from '../lib/whatsapp';

export function AdmissionCRM() {
  const { user } = useAuth();
  const branches = getBranches();
  const [admissions, setAdmissions] = useState<AdmissionRecord[]>(getAdmissions());
  const [branchFilter, setBranchFilter] = useState(user?.role === 'super_admin' ? '' : user?.branchId ?? '');

  useEffect(() => {
    const unsubscribe = subscribeAdmissions(() => setAdmissions(getAdmissions()));
    return unsubscribe;
  }, []);

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
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Total Applications" value={String(stats.total)} change="Live workflow" changeType="positive" icon={UserPlus} iconColor="bg-primary" />
          <StatsCard title="In Progress" value={String(stats.inProgress)} change="Current stage" changeType="positive" icon={Clock} iconColor="bg-chart-4" />
          <StatsCard title="Approved" value={String(stats.approved)} change="Ready for enrollment" changeType="positive" icon={CheckCircle} iconColor="bg-chart-3" />
          <StatsCard title="Enrolled" value={String(stats.enrolled)} change="Student management updated" changeType="positive" icon={FileCheck2} iconColor="bg-accent" />
        </div>

        <DataTable columns={columns} data={filteredAdmissions} />
      </div>
    </div>
  );
}
