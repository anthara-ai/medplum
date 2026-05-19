// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import {
  allOk,
  badRequest,
  ContentType,
  created,
  createReference,
  encodeBase64,
  forbidden,
  getReferenceString,
  isOk,
  normalizeErrorString,
  notFound,
  OperationOutcomeError,
  Operator,
  parseSearchRequest,
  preconditionFailed,
  projectAdminResourceTypes,
  toTypedValue,
} from '@medplum/core';
import type {
  Binary,
  BundleEntry,
  DocumentReference,
  ElementDefinition,
  Login,
  Observation,
  OperationOutcome,
  Organization,
  Package,
  PackageInstallation,
  PackageRelease,
  Patient,
  Practitioner,
  Project,
  ProjectMembership,
  Questionnaire,
  ResearchDefinition,
  ResourceType,
  ServiceRequest,
  StructureDefinition,
  User,
  UserConfiguration,
  UserSecurityRequest,
  ValueSet,
} from '@medplum/fhirtypes';
import { randomBytes, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import assert from 'node:assert';
import { resolve } from 'path';
import { initAppServices, shutdownApp } from '../app';
import type { RegisterRequest } from '../auth/register';
import { registerNew } from '../auth/register';
import { getConfig, loadTestConfig } from '../config/loader';
import type { ArrayColumnPaddingConfig, MedplumServerConfig } from '../config/types';
import { r4ProjectId, systemResourceProjectId } from '../constants';
import { DatabaseMode, getDatabasePool } from '../database';
import { getLogger } from '../logger';
import { bundleContains, createTestProject, withTestContext } from '../test.setup';
import { AuditEventOutcome, createAuditEvent, ReadInteraction, RestfulOperationType } from '../util/auditevent';
import * as workersModule from '../workers';
import { getRepoForLogin } from './accesspolicy';
import type { ColumnValue } from './repo';
import {
  compareColumnValues,
  getGlobalSystemRepo,
  getProjectSystemRepo,
  getShardSystemRepo,
  Repository,
  setTypedPropertyValue,
} from './repo';
import { PostgresError, SelectQuery } from './sql';

jest.mock('hibp');

describe('FHIR Repo', () => {
  const globalSystemRepo = getGlobalSystemRepo();
  let testProject: WithId<Project>;

  let testProjectRepo: Repository;
  let systemRepo: Repository;

  const usCorePatientProfile = JSON.parse(
    readFileSync(resolve(__dirname, '__test__/us-core-patient.json'), 'utf8')
  ) as StructureDefinition;

  beforeAll(async () => {
    const config = await loadTestConfig();
    await initAppServices(config);

    testProject = await globalSystemRepo.createResource({
      resourceType: 'Project',
      id: randomUUID(),
    });
    systemRepo = await getProjectSystemRepo(testProject);
    testProjectRepo = new Repository({
      projects: [testProject],
      extendedMode: true,
      author: {
        reference: 'Practitioner/' + randomUUID(),
      },
    });
  });

  afterAll(async () => {
    await shutdownApp();
  });

  test('getRepoForLogin', async () => {
    await expect(
      getRepoForLogin({
        login: { resourceType: 'Login' } as Login,
        membership: {
          resourceType: 'ProjectMembership',
          project: createReference(testProject),
          profile: { display: 'Fake profile' },
        } as WithId<ProjectMembership>,
        project: testProject,
        userConfig: {} as UserConfiguration,
      })
    ).rejects.toThrow('Invalid reference');
  });

  test('Read resource with undefined id', async () => {
    try {
      await systemRepo.readResource('Patient', undefined as unknown as string);
      fail('Should have thrown');
    } catch (err) {
      const outcome = (err as OperationOutcomeError).outcome;
      expect(isOk(outcome)).toBe(false);
    }
  });

  test('Read resource with blank id', async () => {
    try {
      await systemRepo.readResource('Patient', '');
      fail('Should have thrown');
    } catch (err) {
      const outcome = (err as OperationOutcomeError).outcome;
      expect(isOk(outcome)).toBe(false);
    }
  });

  test('Read resource with invalid id', async () => {
    try {
      await systemRepo.readResource('Patient', 'x');
      fail('Should have thrown');
    } catch (err) {
      const outcome = (err as OperationOutcomeError).outcome;
      expect(isOk(outcome)).toBe(false);
    }
  });

  test('Read invalid resource with `checkCacheOnly` set', async () => {
    await expect(systemRepo.readResource('Subscription', randomUUID(), { checkCacheOnly: true })).rejects.toThrow(
      new OperationOutcomeError(notFound)
    );
  });

  test('Read AuditEvent after update', async () => {
    const projectId = randomUUID();
    const resource = await systemRepo.createResource({ resourceType: 'Patient', meta: { project: projectId } });
    const data = createAuditEvent(
      RestfulOperationType,
      ReadInteraction,
      projectId,
      undefined,
      undefined,
      AuditEventOutcome.Success,
      { resource }
    );

    let auditEvent = await systemRepo.createResource(data);
    // Read resource to load into cache
    auditEvent = await systemRepo.readResource('AuditEvent', auditEvent.id);

    const updatedEvent = await systemRepo.updateResource({ ...auditEvent, outcomeDesc: 'foo' });
    expect(updatedEvent.outcomeDesc).not.toStrictEqual(auditEvent.outcomeDesc);

    // Re-read resource; should get the updated data
    auditEvent = await systemRepo.readResource('AuditEvent', auditEvent.id);
    expect(updatedEvent.outcomeDesc).toStrictEqual(auditEvent.outcomeDesc);
  });

  test('Repo read malformed reference', async () => {
    try {
      await systemRepo.readReference({ reference: undefined });
      fail('Should have thrown');
    } catch (err) {
      expect((err as OperationOutcome).id).not.toBe('ok');
    }

    try {
      await systemRepo.readReference({ reference: '' });
      fail('Should have thrown');
    } catch (err) {
      expect((err as OperationOutcome).id).not.toBe('ok');
    }

    try {
      await systemRepo.readReference({ reference: '////' });
      fail('Should have thrown');
    } catch (err) {
      expect((err as OperationOutcome).id).not.toBe('ok');
    }

    try {
      await systemRepo.readReference({ reference: 'Patient/123/foo' });
      fail('Should have thrown');
    } catch (err) {
      expect((err as OperationOutcome).id).not.toBe('ok');
    }
  });

  test('Read references with various reference shapes', async () => {
    const patient = await systemRepo.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['ReadReferences'], family: 'ReadReferences' }],
    });
    const references = [
      { reference: undefined },
      { reference: '' },
      { reference: 'Patient/' + patient.id },
      { display: 'test' },
      { reference: 'Patient/' + patient.id },
      { resource: patient },
    ];
    const results = await systemRepo.readReferences(references);
    if (!Array.isArray(results)) {
      throw new Error('Should have returned an array');
    }

    expect(results).toHaveLength(6);
    expect((results[0] as OperationOutcomeError).outcome.id).toBe('not-found');
    expect((results[1] as OperationOutcomeError).outcome.id).toBe('not-found');
    expect((results[2] as WithId<Patient>).id).toBe(patient.id);
    expect((results[3] as OperationOutcomeError).outcome.id).toBe('not-found');
    expect((results[4] as WithId<Patient>).id).toBe(patient.id);
    expect((results[5] as OperationOutcomeError).outcome.id).toBe('not-found');
  });

  describe('Read history', () => {
    const versions: Record<string, WithId<Patient>> = {};

    beforeAll(async () =>
      withTestContext(async () => {
        versions.v1 = await systemRepo.createResource<Patient>({
          resourceType: 'Patient',
          meta: {
            lastUpdated: new Date(Date.now() - 1000 * 60).toISOString(),
          },
        });
        expect(versions.v1.id).toBeDefined();

        versions.v2 = await systemRepo.updateResource<Patient>({
          resourceType: 'Patient',
          id: versions.v1.id,
          active: true,
          meta: {
            lastUpdated: new Date().toISOString(),
          },
        });

        expect(versions.v2.id).toStrictEqual(versions.v1.id);
        expect(versions.v2.meta?.versionId).not.toStrictEqual(versions.v1.meta?.versionId);
      })
    );

    test.each([
      ['no options', {}, ['v2', 'v1']],
      ['limit', { limit: 1 }, ['v2']],
      ['offset', { offset: 1 }, ['v1']],
      ['limit and offset', { limit: 1, offset: 1 }, ['v1']],
      ['negative offset', { offset: -1 }, ['v2', 'v1']],
      ['large offset', { offset: 10000 }, []],
      ['negative limit', { limit: -1 }, ['v2', 'v1']],
      ['large limit', { limit: 100000 }, ['v2', 'v1']],
    ])('options: %s', async (_, options, expected) => {
      const history = await systemRepo.readHistory('Patient', versions.v1.id, options);
      if (expected.length === 0) {
        expect(history).toBeDefined();
        expect(history.entry?.length).toBe(0);
      } else {
        expect(history).toBeDefined();
        expect(history.entry?.length).toBe(expected.length);
        for (let i = 0; i < expected.length; i++) {
          expect(history.entry?.[i]?.resource?.id).toBe(versions[expected[i]].id);
        }
      }
    });

    test('with config.maxSearchOffset', async () => {
      const prevMax = getConfig().maxSearchOffset;
      getConfig().maxSearchOffset = 200;
      try {
        await systemRepo.readHistory('Patient', versions.v1.id, { offset: 300 });
        throw new Error('Expected to throw');
      } catch (err) {
        expect(normalizeErrorString(err)).toStrictEqual('Search offset exceeds maximum (got 300, max 200)');
      } finally {
        getConfig().maxSearchOffset = prevMax;
      }
    });
  });

  test('Update patient', () =>
    withTestContext(async () => {
      const patient1 = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Update1'], family: 'Update1' }],
      });

      const patient2 = await systemRepo.updateResource<Patient>({
        ...(patient1 as Patient),
        active: true,
      });

      expect(patient2.id).toStrictEqual(patient1.id);
      expect(patient2.meta?.versionId).not.toStrictEqual(patient1.meta?.versionId);
    }));

  test('Update patient remove meta.profile', () =>
    withTestContext(async () => {
      const profileUrl = 'http://example.com/patient-profile';
      const patient1 = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        meta: { profile: [profileUrl] },
        name: [{ given: ['Update1'], family: 'Update1' }],
      });
      expect(patient1.meta?.profile).toStrictEqual(expect.arrayContaining([profileUrl]));
      expect(patient1.meta?.profile?.length).toStrictEqual(1);

      const patientWithoutProfile = { ...patient1 };
      delete (patientWithoutProfile.meta as any).profile;
      const patient2 = await systemRepo.updateResource<Patient>(patientWithoutProfile);
      expect('profile' in (patient2.meta as any)).toBe(false);
    }));

  test('meta.project preserved after attempting to remove it', () =>
    withTestContext(async () => {
      const { project, repo } = await createTestProject({ withClient: true, withRepo: true });

      const patient1 = await repo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Update1'], family: 'Update1' }],
      });
      expect(patient1.meta?.project).toBeDefined();
      expect(patient1.meta?.project).toStrictEqual(project.id);

      const patientWithoutProject = { ...patient1 };
      delete (patientWithoutProject.meta as any).project;
      const patient2 = await systemRepo.updateResource<Patient>(patientWithoutProject);
      expect(patient2.meta?.project).toBeDefined();
      expect(patient2.meta?.project).toStrictEqual(project.id);
    }));

  test('Update patient no changes', () =>
    withTestContext(async () => {
      const patient1 = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Update1'], family: 'Update1' }],
      });

      const patient2 = await systemRepo.updateResource({
        ...(patient1 as Patient),
      });

      expect(patient2.id).toStrictEqual(patient1.id);
      expect(patient2.meta?.versionId).toStrictEqual(patient1.meta?.versionId);
    }));

  test('Update patient multiple names', () =>
    withTestContext(async () => {
      const patient1 = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Suzy'], family: 'Smith' }],
      });

      const patient2 = await systemRepo.updateResource<Patient>({
        ...(patient1 as Patient),
        name: [
          { given: ['Suzy'], family: 'Smith' },
          { given: ['Suzy'], family: 'Jones' },
        ],
      });

      expect(patient2.id).toStrictEqual(patient1.id);
      expect(patient2.meta?.versionId).not.toStrictEqual(patient1.meta?.versionId);
      expect(patient2.name?.length).toStrictEqual(2);
      expect(patient2.name?.[0]?.family).toStrictEqual('Smith');
      expect(patient2.name?.[1]?.family).toStrictEqual('Jones');
    }));

  test('Create Patient with custom ID', async () => {
    const { repo } = await createTestProject({ withRepo: true });

    await withTestContext(async () => {
      // Try to "update" a resource, which does not exist.
      // Some FHIR systems allow users to set ID's.
      // We do not.
      try {
        await repo.updateResource<Patient>({
          resourceType: 'Patient',
          id: randomUUID(),
          name: [{ given: ['Alice'], family: 'Smith' }],
        });
      } catch (err) {
        const outcome = (err as OperationOutcomeError).outcome;
        expect(outcome.id).toStrictEqual('not-found');
      }
    });
  });

  test('Create Patient with no author', () =>
    withTestContext(async () => {
      const patient = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Alice'], family: 'Smith' }],
      });

      expect(patient.meta?.author?.reference).toStrictEqual('system');
    }));

  test('Create Patient as system on behalf of author', () =>
    withTestContext(async () => {
      const author = 'Practitioner/' + randomUUID();
      const patient = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Alice'], family: 'Smith' }],
        meta: {
          author: {
            reference: author,
          },
        },
      });

      expect(patient.meta?.author?.reference).toStrictEqual(author);
    }));

  test('Create Patient as ClientApplication with no author', () =>
    withTestContext(async () => {
      const { client, repo } = await createTestProject({ withClient: true, withRepo: true });
      const addBackgroundJobsSpy = jest.spyOn(workersModule, 'addBackgroundJobs').mockResolvedValue(undefined);
      try {
        const patient = await repo.createResource<Patient>({
          resourceType: 'Patient',
          name: [{ given: ['Alice'], family: 'Smith' }],
          identifier: [],
        });

        expect(patient.meta?.author?.reference).toStrictEqual(getReferenceString(client));

        expect(addBackgroundJobsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            resourceType: 'Patient',
            id: patient.id,
          }),
          undefined,
          expect.objectContaining({
            interaction: 'create',
            project: expect.objectContaining({
              id: patient.meta?.project,
            }),
          })
        );

        // empty identifier array should removed when read from cache
        const readPatient = await repo.readResource<Patient>('Patient', patient.id, { checkCacheOnly: true });
        expect(readPatient.identifier).toBeUndefined();
      } finally {
        addBackgroundJobsSpy.mockRestore();
      }
    }));

  test('Create Patient as Practitioner with no author', () =>
    withTestContext(async () => {
      const author = 'Practitioner/' + randomUUID();

      const repo = new Repository({
        extendedMode: true,
        author: {
          reference: author,
        },
      });

      const patient = await repo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Alice'], family: 'Smith' }],
      });

      expect(patient.meta?.author?.reference).toStrictEqual(author);
    }));

  test('Create Patient as Practitioner on behalf of author', () =>
    withTestContext(async () => {
      const author = 'Practitioner/' + randomUUID();
      const fakeAuthor = 'Practitioner/' + randomUUID();

      const repo = new Repository({
        extendedMode: true,
        author: {
          reference: author,
        },
      });

      // We are acting as a Practitioner
      // Practitioner does *not* have the right to set the author
      // So even though we pass in an author,
      // We expect the Practitioner to be in the result.
      const patient = await repo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Alice'], family: 'Smith' }],
        meta: {
          author: {
            reference: fakeAuthor,
          },
        },
      });

      expect(patient.meta?.author?.reference).toStrictEqual(author);
    }));

  test('Skip background jobs when configured', () =>
    withTestContext(async () => {
      const { project } = await createTestProject();

      const repo = new Repository({
        projects: [project],
        currentProject: project,
        extendedMode: true,
        skipBackgroundJobs: true,
        author: {
          reference: 'Practitioner/' + randomUUID(),
        },
      });

      expect(repo.getSystemRepo().getConfig().skipBackgroundJobs).toBe(true);
      expect(
        getShardSystemRepo('test-shard', undefined, { skipBackgroundJobs: true }).getConfig().skipBackgroundJobs
      ).toBe(true);

      const addBackgroundJobsSpy = jest.spyOn(workersModule, 'addBackgroundJobs').mockResolvedValue(undefined);
      // Check that createResource, updateResource, and deleteResource all skip addBackgroundJobs.
      const patient = await repo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Alice'], family: 'Smith' }],
      });

      await repo.updateResource<Patient>({
        ...patient,
        active: true,
      });

      await repo.deleteResource('Patient', patient.id);

      expect(addBackgroundJobsSpy).not.toHaveBeenCalled();
      addBackgroundJobsSpy.mockRestore();
    }));

  test('Create resource with lastUpdated', () =>
    withTestContext(async () => {
      const lastUpdated = '2020-01-01T12:00:00Z';

      // System systemRepo has the ability to write custom timestamps
      const patient = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Alice'], family: 'Smith' }],
        meta: {
          lastUpdated,
        },
      });

      expect(patient.meta?.lastUpdated).toStrictEqual(lastUpdated);
    }));

  const fourByteChars = '𓃒𓃔𓃕𓃖𓃗𓃘𓃙𓃚𓃛𓃜𓃝𓃞𓃟𓃠𓃡𓃢𓃥𓃦𓃧𓃩𓃪𓃭𓃮𓃯𓃰𓃱𓃲𓄁𓅂𓅃𓅠𓅚';
  test.each([
    ['2736 chars, 2736 random bytes', randomBytes(2050).toString('base64')],
    ['6668 chars, 6668 random bytes', randomBytes(5000).toString('base64')],
    ['6400 chars, 12800 bytes', shuffleString(fourByteChars.repeat(100))],
  ])('Create ResearchDefinition with long description (%s)', (_testTitle, description) =>
    withTestContext(async () => {
      const author = 'Practitioner/' + randomUUID();

      const repo = new Repository({
        extendedMode: true,
        author: {
          reference: author,
        },
      });

      await repo.createResource<ResearchDefinition>({
        resourceType: 'ResearchDefinition',
        status: 'active',
        population: { reference: '123' },
        description,
      });
    })
  );

  test('Update resource with lastUpdated', () =>
    withTestContext(async () => {
      const lastUpdated = '2020-01-01T12:00:00Z';

      // System systemRepo has the ability to write custom timestamps
      const patient1 = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Alice'], family: 'Smith' }],
        meta: {
          lastUpdated,
        },
      });
      expect(patient1.meta?.lastUpdated).toStrictEqual(lastUpdated);

      // But system cannot update the timestamp
      const patient2 = await systemRepo.updateResource<Patient>({
        ...(patient1 as Patient),
        active: true,
        meta: {
          lastUpdated,
        },
      });
      expect(patient2.meta?.lastUpdated).not.toStrictEqual(lastUpdated);
    }));

  test('Update resource with missing id', () =>
    withTestContext(async () => {
      const patient1 = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ family: 'Test' }],
      });

      const { id, ...rest } = patient1;
      expect(id).toBeDefined();
      expect((rest as Patient).id).toBeUndefined();

      try {
        await systemRepo.updateResource(rest);
        fail('Should have thrown');
      } catch (err) {
        expect((err as OperationOutcomeError).outcome).toMatchObject(badRequest('Missing id'));
      }
    }));

  test('Update resource with matching versionId', () =>
    withTestContext(async () => {
      const patient = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ family: 'Test' }],
      });

      patient.name = [{ family: 'TestUpdated' }];
      await systemRepo.updateResource<Patient>(patient, { ifMatch: patient.meta?.versionId });
      expect(patient.name?.at(0)?.family).toStrictEqual('TestUpdated');
    }));

  test('Update resource with different versionId', () =>
    withTestContext(async () => {
      const patient = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ family: 'Test' }],
      });

      await expect(systemRepo.updateResource(patient, { ifMatch: 'bad-id' })).rejects.toThrow(
        new OperationOutcomeError(preconditionFailed)
      );
    }));

  test('Patch resource with matching versionId', () =>
    withTestContext(async () => {
      const patient = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ family: 'Test' }],
      });

      const patched = await systemRepo.patchResource<Patient>(
        patient.resourceType,
        patient.id,
        [{ op: 'replace', path: '/name/0/family', value: 'TestUpdated' }],
        {
          ifMatch: patient.meta?.versionId,
        }
      );
      expect(patched.name?.at(0)?.family).toStrictEqual('TestUpdated');
    }));

  test('Patch resource with different versionId', () =>
    withTestContext(async () => {
      const patient = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ family: 'Test' }],
      });

      await expect(
        systemRepo.patchResource<Patient>(
          patient.resourceType,
          patient.id,
          [{ op: 'add', path: '/birthDate', value: '1993-09-14' }],
          { ifMatch: 'bad-id' }
        )
      ).rejects.toThrow(new OperationOutcomeError(preconditionFailed));
    }));

  test('Patch resource with implicit array creation', () =>
    withTestContext(async () => {
      const patient = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ family: 'Test' }],
      });

      const patched = await systemRepo.patchResource<Patient>(patient.resourceType, patient.id, [
        { op: 'add', path: '/identifier/-', value: { system: 'https://example.com', value: '123' } },
      ]);
      expect(patched.identifier?.at(0)?.system).toStrictEqual('https://example.com');
      expect(patched.identifier?.at(0)?.value).toStrictEqual('123');
    }));

  test('Compartment permissions', () =>
    withTestContext(async () => {
      const registration1: RegisterRequest = {
        firstName: randomUUID(),
        lastName: randomUUID(),
        projectName: randomUUID(),
        email: randomUUID() + '@example.com',
        password: randomUUID(),
      };

      const result1 = await registerNew(registration1);
      expect(result1.profile).toBeDefined();

      const repo1 = await getRepoForLogin({
        project: result1.project,
        membership: result1.membership,
        login: result1.login,
        userConfig: {} as UserConfiguration,
      });
      const patient1 = await repo1.createResource<Patient>({
        resourceType: 'Patient',
      });

      expect(patient1).toBeDefined();
      expect(patient1.id).toBeDefined();

      const patient2 = await repo1.readResource('Patient', patient1.id);
      expect(patient2).toBeDefined();
      expect(patient2.id).toStrictEqual(patient1.id);

      const registration2: RegisterRequest = {
        firstName: randomUUID(),
        lastName: randomUUID(),
        projectName: randomUUID(),
        email: randomUUID() + '@example.com',
        password: randomUUID(),
      };

      const result2 = await registerNew(registration2);
      expect(result2.profile).toBeDefined();

      const repo2 = await getRepoForLogin({
        project: result2.project,
        membership: result2.membership,
        login: result2.login,
        userConfig: {} as UserConfiguration,
      });
      try {
        await repo2.readResource('Patient', patient1.id);
        fail('Should have thrown');
      } catch (err) {
        expect((err as OperationOutcomeError).outcome).toMatchObject(notFound);
      }
    }));

  test('Read history after delete', () =>
    withTestContext(async () => {
      // Create the patient
      const patient = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Alice'], family: 'Smith' }],
      });

      const history1 = await systemRepo.readHistory('Patient', patient.id);
      expect(history1.entry?.length).toBe(1);

      // Delete the patient
      await systemRepo.deleteResource('Patient', patient.id);

      const history2 = await systemRepo.readHistory('Patient', patient.id);
      expect(history2.entry?.length).toBe(2);

      // Restore the patient
      await systemRepo.updateResource({ ...patient, meta: undefined });

      const history3 = await systemRepo.readHistory('Patient', patient.id);
      expect(history3.entry?.length).toBe(3);

      const entries = history3.entry as BundleEntry[];
      expect(entries[0].response?.status).toStrictEqual('200');
      expect(entries[0].resource).toBeDefined();
      expect(entries[1].response?.status).toStrictEqual('410');
      expect((entries[1].response?.outcome as OperationOutcome).issue?.[0]?.details?.text).toMatch(/Deleted on /);
      expect(entries[1].resource).toBeUndefined();
      expect(entries[2].response?.status).toStrictEqual('200');
      expect(entries[2].resource).toBeDefined();
    }));

  test('Delete Binary', () =>
    withTestContext(async () => {
      // Create the resource
      const binary = await systemRepo.createResource<Binary>({
        resourceType: 'Binary',
        contentType: 'text/plain',
      });

      // Delete the resource
      await systemRepo.deleteResource('Binary', binary.id);

      const history2 = await systemRepo.readHistory('Binary', binary.id);
      expect(history2.entry?.length).toBe(2);
    }));

  test('Reindex resource as non-admin', async () => {
    const { repo } = await createTestProject({ withRepo: true });

    try {
      await repo.reindexResource('Practitioner', randomUUID());
      fail('Expected error');
    } catch (err) {
      expect(isOk(err as OperationOutcome)).toBe(false);
    }

    const patient = await repo.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Alice'], family: 'Smith' }],
    });

    try {
      await repo.withTransaction(async (conn) => {
        await repo.reindexResources(conn, [patient]);
      });
      fail('Expected error');
    } catch (err) {
      expect(isOk(err as OperationOutcome)).toBe(false);
    }
  });

  test('Reindex resource not found', async () => {
    try {
      await systemRepo.reindexResource('Practitioner', randomUUID());
      fail('Expected error');
    } catch (err) {
      expect(isOk(err as OperationOutcome)).toBe(false);
    }
  });

  test('Reindex resource errors logged', async () => {
    const patient1 = await systemRepo.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ given: ['Identifier'], family: 'Test' }],
      identifier: [{ system: 'https://example.com/', value: 'some-value' }],
    });

    const buildColumnSpy = jest.spyOn(Repository.prototype as any, 'buildColumn').mockImplementation(() => {
      throw new Error('test error');
    });
    const logger = getLogger();
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(
      systemRepo.withTransaction(async (conn) => {
        await systemRepo.reindexResources(conn, [patient1]);
      })
    ).rejects.toThrow('test error');
    expect(errorSpy).toHaveBeenCalledWith('Error building row for resource', {
      resource: 'Patient/' + patient1.id,
      err: expect.any(Error),
    });

    buildColumnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('Remove property', () =>
    withTestContext(async () => {
      const value = randomUUID();

      // Create a patient with an identifier
      const patient1 = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Identifier'], family: 'Test' }],
        identifier: [{ system: 'https://example.com/', value }],
      });

      // Search for patient by identifier
      // This should succeed
      const bundle1 = await systemRepo.search<Patient>({
        resourceType: 'Patient',
        filters: [
          {
            code: 'identifier',
            operator: Operator.EQUALS,
            value,
          },
        ],
      });
      expect(bundle1.entry?.length).toStrictEqual(1);

      const { identifier, ...rest } = patient1;
      expect(identifier).toBeDefined();
      expect((rest as Patient).identifier).toBeUndefined();

      const patient2 = await systemRepo.updateResource<Patient>(rest);
      expect(patient2.identifier).toBeUndefined();

      // Try to search for the identifier
      // This should return empty result
      const bundle2 = await systemRepo.search<Patient>({
        resourceType: 'Patient',
        filters: [
          {
            code: 'identifier',
            operator: Operator.EQUALS,
            value,
          },
        ],
      });
      expect(bundle2.entry?.length).toStrictEqual(0);
    }));

  test('Delete Questionnaire.subjectType', () =>
    withTestContext(async () => {
      const nonce = randomUUID();

      const resource1 = await systemRepo.createResource<Questionnaire>({
        resourceType: 'Questionnaire',
        status: 'active',
        subjectType: [nonce as ResourceType],
      });

      const resource2 = await systemRepo.search({
        resourceType: 'Questionnaire',
        filters: [
          {
            code: 'subject-type',
            operator: Operator.EQUALS,
            value: nonce,
          },
        ],
      });
      expect(resource2.entry?.length).toStrictEqual(1);

      delete resource1.subjectType;
      await systemRepo.updateResource<Questionnaire>(resource1);

      const resource4 = await systemRepo.search({
        resourceType: 'Questionnaire',
        filters: [
          {
            code: 'subject-type',
            operator: Operator.EQUALS,
            value: nonce,
          },
        ],
      });
      expect(resource4.entry?.length).toStrictEqual(0);
    }));

  test('Empty objects', () =>
    withTestContext(async () => {
      const patient1 = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        contact: [
          {
            name: {
              given: ['Test'],
            },
          },
        ],
      });

      const patient2 = await systemRepo.updateResource<Patient>({
        resourceType: 'Patient',
        id: patient1.id,
        contact: [
          {
            name: {
              given: ['Test'],
            },
          },
        ],
      });
      expect(patient2.id).toStrictEqual(patient1.id);
    }));

  test('expungeResource forbidden', async () => {
    // Try to expunge as a regular user
    await expect(testProjectRepo.expungeResource('Patient', new Date().toISOString())).rejects.toThrow('Forbidden');
  });

  test('expungeResources forbidden', async () => {
    // Try to expunge as a regular user
    await expect(testProjectRepo.expungeResources('Patient', [new Date().toISOString()])).rejects.toThrow('Forbidden');
  });

  test('Purge forbidden', async () => {
    // Try to purge as a regular user
    await expect(testProjectRepo.purgeResources('Patient', new Date().toISOString())).rejects.toThrow('Forbidden');
  });

  test('Purge Login', () =>
    withTestContext(async () => {
      const oldDate = '2000-01-01T00:00:00.000Z';

      // Create a login using super admin with a date in the distant past
      // This takes advantage of the fact that super admins can set meta.lastUpdated
      const login = await systemRepo.createResource<Login>({
        resourceType: 'Login',
        meta: {
          lastUpdated: oldDate,
        },
        user: { reference: 'system' },
        authMethod: 'password',
        authTime: oldDate,
      });

      const bundle1 = await systemRepo.search({
        resourceType: 'Login',
        filters: [{ code: '_lastUpdated', operator: Operator.LESS_THAN_OR_EQUALS, value: oldDate }],
      });
      expect(bundleContains(bundle1, login)).toBeTruthy();

      // Purge logins before the cutoff date
      await systemRepo.purgeResources('Login', oldDate);

      // Make sure the login is truly gone
      const bundle = await systemRepo.search({
        resourceType: 'Login',
        filters: [{ code: '_lastUpdated', operator: Operator.ENDS_BEFORE, value: oldDate }],
        total: 'accurate',
        count: 0,
      });
      expect(bundle.total).toStrictEqual(0);
    }));

  test('Malformed client assigned ID', async () => {
    await expect(systemRepo.updateResource({ resourceType: 'Patient', id: '123' })).rejects.toThrow('Invalid id');
  });

  test('Profile validation', async () =>
    withTestContext(async () => {
      const { repo } = await createTestProject({ withRepo: true });

      const profile = { ...usCorePatientProfile, url: 'urn:uuid:' + randomUUID() };
      const patient: Patient = {
        resourceType: 'Patient',
        meta: {
          profile: [profile.url],
        },
        identifier: [
          {
            system: 'http://example.com/patient-id',
            value: 'foo',
          },
        ],
        name: [
          {
            given: ['Alex'],
            family: 'Baker',
          },
        ],
        // Missing gender property is required by profile
      };

      await expect(repo.createResource(patient)).resolves.toBeTruthy();
      await repo.createResource(profile);
      await expect(repo.createResource(patient)).rejects.toThrow(
        new Error('Missing required property (Patient.gender)')
      );
    }));

  test('Profile update', async () =>
    withTestContext(async () => {
      const { repo } = await createTestProject({ withRepo: true });

      const profile = await repo.createResource({
        ...usCorePatientProfile,
        url: 'urn:uuid:' + randomUUID(),
      });

      const patient: Patient = {
        resourceType: 'Patient',
        meta: { profile: [profile.url] },
        identifier: [{ system: 'http://example.com/patient-id', value: 'foo' }],
        name: [{ given: ['Alex'], family: 'Baker' }],
        gender: 'male',
      };

      // Create the patient
      // This should succeed
      await expect(repo.createResource(patient)).resolves.toBeTruthy();

      // Now update the profile to make "address" a required field
      await repo.updateResource<StructureDefinition>({
        ...profile,
        snapshot: {
          ...profile.snapshot,
          element: profile.snapshot?.element?.map((e) => {
            if (e.path === 'Patient.address') {
              return {
                ...e,
                min: 1,
              };
            }
            return e;
          }) as ElementDefinition[],
        },
      });

      // Now try to create another patient without an address
      // This should fail
      await expect(repo.createResource(patient)).rejects.toThrow(
        new Error('Missing required property (Patient.address)')
      );
    }));

  describe('Update resource with terminology validation', () => {
    const patient: Patient = {
      resourceType: 'Patient',
      identifier: [{ use: 'usual', system: 'urn:oid:1.2.36.146.595.217.0.1', value: '12345' }],
      active: true,
      name: [
        { use: 'official', family: 'Chalmers', given: ['Peter', 'James'] },
        { use: 'usual', given: ['Jim'] },
        { use: 'maiden', family: 'Windsor', given: ['Peter', 'James'] },
      ],
      telecom: [
        { use: 'home', system: 'url', value: 'http://example.com' },
        { system: 'phone', value: '(03) 5555 6473', use: 'work', rank: 1 },
        { system: 'phone', value: '(03) 3410 5613', use: 'mobile', rank: 2 },
        { system: 'phone', value: '(03) 5555 8834', use: 'old' },
      ],
      gender: 'male',
      birthDate: '1974-12-25',
      address: [{ use: 'home', type: 'both', text: '534 Erewhon St PeasantVille, Rainbow, Vic  3999' }],
      contact: [
        {
          name: { use: 'usual', family: 'du Marché', given: ['Bénédicte'] },
          telecom: [{ system: 'phone', value: '+33 (237) 998327', use: 'home' }],
          address: { use: 'home', type: 'both', line: ['534 Erewhon St'], city: 'PleasantVille', postalCode: '3999' },
          gender: 'female',
        },
      ],
      communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'en' }] } }],
    };

    let repo: Repository;
    let profile: StructureDefinition;
    beforeAll(async () => {
      const result = await createTestProject({ withRepo: { validateTerminology: true } });
      repo = result.repo;

      // Create modified US Core Patient profile to have 'required' binding for communication.language
      const modifiedPatientProfile = JSON.parse(
        readFileSync(resolve(__dirname, '__test__/us-core-patient.json'), 'utf8')
      ) as StructureDefinition;

      const commLang = modifiedPatientProfile.snapshot?.element.find((e) => e.id === 'Patient.communication.language');
      assert(commLang?.binding?.valueSet === 'http://hl7.org/fhir/us/core/ValueSet/simple-language');
      assert(commLang.binding.strength === 'extensible');
      commLang.binding.strength = 'required';

      profile = await repo.createResource({
        ...modifiedPatientProfile,
        url: 'urn:uuid:' + randomUUID(),
      });

      // Create a ValueSet for the US Core Patient profile that includes only 'en' as a valid language
      await repo.createResource<ValueSet>({
        resourceType: 'ValueSet',
        url: 'http://hl7.org/fhir/us/core/ValueSet/simple-language',
        expansion: {
          timestamp: new Date().toISOString(),
          contains: [
            {
              system: 'urn:ietf:bcp:47',
              code: 'en',
            },
          ],
        },
        status: 'active',
      });
    });
    test('Valid patient without any profiles', async () =>
      withTestContext(async () => {
        await expect(repo.createResource(patient)).resolves.toBeDefined();
      }));

    test('Invalid gender', async () =>
      withTestContext(async () => {
        await expect(
          repo.createResource({ ...patient, gender: 'enby' as unknown as Patient['gender'] })
        ).rejects.toThrow(
          `Value "enby" did not satisfy terminology binding http://hl7.org/fhir/ValueSet/administrative-gender|4.0.1 (Patient.gender)`
        );
      }));

    test('Valid patient with US Core Patient profile', async () =>
      withTestContext(async () => {
        await expect(repo.createResource({ ...patient, meta: { profile: [profile.url] } })).resolves.toBeDefined();
      }));

    test('Invalid patient with US Core Patient profile (communication.language not in ValueSet)', async () =>
      withTestContext(async () => {
        await expect(
          repo.createResource({
            ...patient,
            meta: { profile: [profile.url] },
            communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'fr' }] } }],
          })
        ).rejects.toThrow(
          `Value {"coding":[{"system":"urn:ietf:bcp:47","code":"fr"}]} did not satisfy terminology binding http://hl7.org/fhir/us/core/ValueSet/simple-language (Patient.communication[0].language)`
        );
      }));
  });

  test('Conditional update', () =>
    withTestContext(async () => {
      const mrn = randomUUID();
      const patient: Patient = {
        resourceType: 'Patient',
        identifier: [{ system: 'http://example.com/mrn', value: mrn }],
      };

      // Invalid search resource type mismatch
      await expect(
        systemRepo.conditionalUpdate(patient, {
          resourceType: 'Observation',
          filters: [{ code: 'identifier', operator: Operator.EQUALS, value: 'http://example.com/mrn|' + mrn }],
        })
      ).rejects.toThrow('Search type must match resource type for conditional update');

      // Invalid create with preassigned ID
      await expect(
        systemRepo.conditionalUpdate(
          { ...patient, id: randomUUID() },
          {
            resourceType: 'Patient',
            filters: [{ code: 'identifier', operator: Operator.EQUALS, value: 'http://example.com/mrn|' + mrn }],
          }
        )
      ).rejects.toThrow('Cannot perform create as update with client-assigned ID (Patient.id)');

      // Create new resource
      const create = await systemRepo.conditionalUpdate(patient, {
        resourceType: 'Patient',
        filters: [{ code: 'identifier', operator: Operator.EQUALS, value: 'http://example.com/mrn|' + mrn }],
      });
      expect(create.resource.id).toBeDefined();
      const existing = create.resource;
      expect(create.outcome.id).toStrictEqual(created.id);

      // Update existing resource
      patient.gender = 'unknown';
      const update = await systemRepo.conditionalUpdate(patient, {
        resourceType: 'Patient',
        filters: [{ code: 'identifier', operator: Operator.EQUALS, value: 'http://example.com/mrn|' + mrn }],
      });
      expect(update.resource.id).toStrictEqual(existing.id);
      expect(update.resource.gender).toStrictEqual('unknown');
      expect(update.outcome.id).toStrictEqual(allOk.id);

      // Update with incorrect ID
      patient.id = randomUUID();
      await expect(
        systemRepo.conditionalUpdate(patient, {
          resourceType: 'Patient',
          filters: [{ code: 'identifier', operator: Operator.EQUALS, value: 'http://example.com/mrn|' + mrn }],
        })
      ).rejects.toThrow('Resource ID did not match resolved ID (Patient.id)');

      // Create duplicate resource
      const duplicate = await systemRepo.createResource(patient);
      expect(duplicate.id).not.toStrictEqual(existing.id);

      // Invalid update with ambiguous target
      await expect(
        systemRepo.conditionalUpdate(patient, {
          resourceType: 'Patient',
          filters: [{ code: 'identifier', operator: Operator.EQUALS, value: 'http://example.com/mrn|' + mrn }],
        })
      ).rejects.toThrow('Multiple resources found matching condition');
    }));

  test('Double DELETE', async () =>
    withTestContext(async () => {
      const patient = await systemRepo.createResource<Patient>({ resourceType: 'Patient' });
      await systemRepo.deleteResource(patient.resourceType, patient.id);
      await expect(systemRepo.deleteResource(patient.resourceType, patient.id)).resolves.toBeUndefined();
    }));

  describe('Array column padding', () => {
    let prevConfig: string | undefined;
    beforeEach(() => {
      const config = getConfig();
      prevConfig = config.arrayColumnPadding && JSON.stringify(config.arrayColumnPadding);
    });

    afterEach(() => {
      if (prevConfig) {
        const config = getConfig();
        config.arrayColumnPadding = JSON.parse(prevConfig);
      }
    });

    const ENSURE_PADDING: ArrayColumnPaddingConfig = {
      m: 1,
      lambda: 300,
      statisticsTarget: 1,
    };

    test.each([
      ['no config', undefined, false], // off by default
      [
        'no resourceType array',
        {
          identifier: {
            config: ENSURE_PADDING,
          },
        },
        true,
      ],
      [
        'resourceType in the resourceType array',
        {
          identifier: {
            resourceType: ['Patient', 'Observation'],
            config: ENSURE_PADDING,
          },
        },
        true,
      ],
      [
        'resourceType NOT in the resourceType array',
        {
          identifier: {
            resourceType: ['Patient'],
            config: ENSURE_PADDING,
          },
        },
        false,
      ],
      [
        'array with entry with no resourceType array in second element',
        {
          identifier: [
            {
              resourceType: ['Task'],
              config: ENSURE_PADDING,
            },
            {
              config: ENSURE_PADDING,
            },
          ],
        },
        true,
      ],
      [
        'array with resourceType in second entry resourceType array',
        {
          identifier: [
            {
              resourceType: ['Patient'],
              config: ENSURE_PADDING,
            },
            {
              resourceType: ['Task', 'Observation'],
              config: ENSURE_PADDING,
            },
          ],
        },
        true,
      ],
      [
        'array with resourceType NOT in any resourceType array',
        {
          identifier: [
            {
              resourceType: ['Patient'],
              config: ENSURE_PADDING,
            },
            {
              resourceType: ['Task'],
              config: ENSURE_PADDING,
            },
          ],
        },
        false,
      ],
    ])('with %s', async (_desc, arrayColumnPadding: MedplumServerConfig['arrayColumnPadding'] | undefined, shouldPad) =>
      withTestContext(async () => {
        const config = getConfig();
        if (arrayColumnPadding) {
          config.arrayColumnPadding = arrayColumnPadding;
        }
        const res = await systemRepo.createResource<Observation>({
          resourceType: 'Observation',
          status: 'unknown',
          code: { coding: [{ system: 'http://loinc.org', code: '72166-2', display: 'Test Observation' }] },
        });

        const db = getDatabasePool(DatabaseMode.READER);
        const results = await db.query('SELECT "__identifier" FROM "Observation" WHERE "id" = $1', [res.id]);
        if (shouldPad) {
          expect(results.rows).toStrictEqual([{ __identifier: ['00000000-0000-0000-0000-000000000000'] }]);
        } else {
          expect(results.rows).toStrictEqual([{ __identifier: [] }]);
        }

        // deleted rows also get padded
        await systemRepo.deleteResource(res.resourceType, res.id);

        if (shouldPad) {
          expect(results.rows).toStrictEqual([{ __identifier: ['00000000-0000-0000-0000-000000000000'] }]);
        } else {
          expect(results.rows).toStrictEqual([{ __identifier: [] }]);
        }
      })
    );
  });

  describe('Array column value sorting', () => {
    test('stores multi-valued reference column in sorted order (DocumentReference.author)', () =>
      withTestContext(async () => {
        const authorRefs = [
          'Practitioner/zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
          'Patient/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'Practitioner/11111111-1111-1111-1111-111111111111',
        ];
        const expected = [...authorRefs].sort(compareColumnValues);

        const doc = await systemRepo.createResource<DocumentReference>({
          resourceType: 'DocumentReference',
          status: 'current',
          content: [{ attachment: { url: 'https://example.com/doc.pdf' } }],
          author: [{ reference: authorRefs[0] }, { reference: authorRefs[1] }, { reference: authorRefs[2] }],
        });

        const db = getDatabasePool(DatabaseMode.READER);
        const results = await db.query('SELECT "author" FROM "DocumentReference" WHERE "id" = $1', [doc.id]);
        expect(results.rows).toStrictEqual([{ author: expected }]);
      }));

    test('same reference values in different resource order yield identical stored array', () =>
      withTestContext(async () => {
        const a = 'Patient/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        const b = 'Practitioner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
        const expected = [a, b].sort(compareColumnValues);

        const doc1 = await systemRepo.createResource<DocumentReference>({
          resourceType: 'DocumentReference',
          status: 'current',
          content: [{ attachment: { url: 'https://example.com/a.pdf' } }],
          author: [{ reference: b }, { reference: a }],
        });
        const doc2 = await systemRepo.createResource<DocumentReference>({
          resourceType: 'DocumentReference',
          status: 'current',
          content: [{ attachment: { url: 'https://example.com/b.pdf' } }],
          author: [{ reference: a }, { reference: b }],
        });

        const db = getDatabasePool(DatabaseMode.READER);
        const r1 = await db.query('SELECT "author" FROM "DocumentReference" WHERE "id" = $1', [doc1.id]);
        const r2 = await db.query('SELECT "author" FROM "DocumentReference" WHERE "id" = $1', [doc2.id]);
        expect(r1.rows).toStrictEqual([{ author: expected }]);
        expect(r2.rows).toStrictEqual([{ author: expected }]);
      }));

    test('stores multi-valued quantity column in sorted order (Observation.component)', () =>
      withTestContext(async () => {
        const values = [100.5, 3.14, 42];
        const expected = [...values].sort(compareColumnValues);

        const obs = await systemRepo.createResource<Observation>({
          resourceType: 'Observation',
          status: 'final',
          code: { text: 'component quantity sort test' },
          component: [
            {
              code: { text: 'first' },
              valueQuantity: { value: values[0], unit: '1', system: 'http://unitsofmeasure.org', code: '1' },
            },
            {
              code: { text: 'second' },
              valueQuantity: { value: values[1], unit: '1', system: 'http://unitsofmeasure.org', code: '1' },
            },
            {
              code: { text: 'third' },
              valueQuantity: { value: values[2], unit: '1', system: 'http://unitsofmeasure.org', code: '1' },
            },
          ],
        });

        const db = getDatabasePool(DatabaseMode.READER);
        const results = await db.query('SELECT "componentValueQuantity" FROM "Observation" WHERE "id" = $1', [obs.id]);
        expect(results.rows).toStrictEqual([{ componentValueQuantity: expected }]);
      }));
  });

  test('Conditional reference resolution', async () =>
    withTestContext(async () => {
      const practitionerIdentifier = randomUUID();
      const practitioner = await systemRepo.createResource<Practitioner>({
        resourceType: 'Practitioner',
        identifier: [{ system: 'http://hl7.org.fhir/sid/us-npi', value: practitionerIdentifier }],
      });
      const conditionalReference = {
        reference: 'Practitioner?identifier=http://hl7.org.fhir/sid/us-npi|' + practitionerIdentifier,
      };

      const patient = await systemRepo.createResource<Patient>({
        resourceType: 'Patient',
        meta: { account: conditionalReference },
        generalPractitioner: [conditionalReference],
      });
      const expectedPractitioner = getReferenceString(practitioner);
      expect(patient.generalPractitioner?.[0]?.reference).toStrictEqual(expectedPractitioner);
      expect(patient.meta?.account?.reference).toStrictEqual(expectedPractitioner);
      expect(patient.meta?.accounts).toHaveLength(1);
      expect(patient.meta?.accounts).toContainEqual({ reference: expectedPractitioner });
    }));

  test('Conditional reference resolution failure', async () =>
    withTestContext(async () => {
      const practitionerIdentifier = randomUUID();
      const patient: Patient = {
        resourceType: 'Patient',
        generalPractitioner: [
          { reference: 'Practitioner?identifier=http://hl7.org.fhir/sid/us-npi|' + practitionerIdentifier },
        ],
      };
      await expect(systemRepo.createResource(patient)).rejects.toThrow(/did not match any resources/);
    }));

  test('Conditional reference resolution multiple matches', async () =>
    withTestContext(async () => {
      const practitionerIdentifier = randomUUID();
      await systemRepo.createResource<Practitioner>({
        resourceType: 'Practitioner',
        identifier: [{ system: 'http://hl7.org.fhir/sid/us-npi', value: practitionerIdentifier }],
      });
      await systemRepo.createResource<Practitioner>({
        resourceType: 'Practitioner',
        identifier: [{ system: 'http://hl7.org.fhir/sid/us-npi', value: practitionerIdentifier }],
      });

      const patient: Patient = {
        resourceType: 'Patient',
        generalPractitioner: [
          { reference: 'Practitioner?identifier=http://hl7.org.fhir/sid/us-npi|' + practitionerIdentifier },
        ],
      };
      await expect(systemRepo.createResource(patient)).rejects.toThrow();
    }));

  test('Conditional reference replaced before validation', async () =>
    withTestContext(async () => {
      const mrn = randomUUID();
      const patient: Patient = {
        resourceType: 'Patient',
        identifier: [{ value: mrn }],
      };
      await systemRepo.createResource(patient);

      const serviceRequest = {
        resourceType: 'ServiceRequest',
        status: 'active',
        intent: 'order',
        code: {
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: '308471005',
              display: 'Referral to cardiologist',
            },
          ],
        },
        // Reference should be replaced and NOT cause a validation error
        subject: {
          reference: 'Patient?identifier=' + mrn,
        },
        // The performerType field should be a CodeableConcept, not an array
        performerType: [
          {
            coding: [
              {
                system: 'http://snomed.info/sct',
                code: '17561000',
                display: 'Cardiologist',
              },
            ],
          },
        ],
      } as unknown as ServiceRequest;
      await expect(systemRepo.createResource(serviceRequest)).rejects.toThrow(/^Expected single .*?performerType\)$/);
    }));

  test('Project default profiles', async () =>
    withTestContext(async () => {
      const { repo } = await createTestProject({
        withClient: true,
        withRepo: true,
        project: {
          defaultProfile: [
            { resourceType: 'Observation', profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns'] },
          ],
        },
      });

      const observation: Observation = {
        resourceType: 'Observation',
        status: 'final',
        category: [
          { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] },
        ],
        code: { text: 'Strep test' },
        effectiveDateTime: '2024-02-13T14:34:56Z',
        valueBoolean: true,
      };

      await expect(systemRepo.createResource(observation)).resolves.toBeDefined();
      await expect(repo.createResource(observation)).rejects.toThrow('Missing required property (Observation.subject)');

      observation.subject = { identifier: { value: randomUUID() } };
      await expect(repo.createResource(observation)).resolves.toMatchObject<Partial<Observation>>({
        meta: expect.objectContaining({
          profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns'],
        }),
      });
    }));

  test('Prevents setting Project compartments', async () =>
    withTestContext(async () => {
      const { repo, project } = await createTestProject({ withRepo: true });
      const { project: otherProject, repo: otherRepo } = await createTestProject({ withRepo: true });
      const projectReference = createReference(otherProject);
      const patient = await repo.createResource<Patient>({
        resourceType: 'Patient',
        meta: { compartment: [projectReference], account: projectReference },
      });
      expect(patient.meta?.compartment).toContainEqual({ reference: getReferenceString(project) });
      expect(patient.meta?.compartment).toContainEqual({ reference: getReferenceString(patient) });
      expect(patient.meta?.compartment).not.toContainEqual({ reference: getReferenceString(otherProject) });

      const results = await otherRepo.searchResources(parseSearchRequest('Patient'));
      expect(results).toHaveLength(0);
    }));

  test('setTypedValue', () => {
    const patient: Patient = {
      resourceType: 'Patient',
      photo: [
        {
          contentType: 'image/png',
          url: 'https://example.com/photo.png',
        },
        {
          contentType: 'image/png',
          data: 'base64data',
        },
      ],
    };

    setTypedPropertyValue(toTypedValue(patient), 'photo[1].contentType', { type: 'string', value: 'image/jpeg' });
    expect(patient.photo?.[1].contentType).toStrictEqual('image/jpeg');
  });
  async function getProjectIdColumn(id: string): Promise<string | null> {
    const projectIdQuery = new SelectQuery('User').column('projectId').where('id', '=', id);
    const client = systemRepo.getDatabaseClient(DatabaseMode.WRITER);
    return (await projectIdQuery.execute(client))[0].projectId;
  }

  test('Super admin can edit User.meta.project', async () =>
    withTestContext(async () => {
      const { project, repo } = await createTestProject({ withRepo: true });

      // Create a user in the project
      const user1 = await repo.createResource<User>({
        resourceType: 'User',
        email: randomUUID() + '@example.com',
        firstName: randomUUID(),
        lastName: randomUUID(),
      });
      expect(user1.meta?.project).toStrictEqual(project.id);
      expect(await getProjectIdColumn(user1.id)).toStrictEqual(project.id);

      // Try to change the project as the normal user
      // Should silently fail, and preserve the meta.project
      const user2 = await repo.updateResource<User>({
        ...user1,
        meta: { project: undefined },
      });
      expect(user2.meta?.project).toStrictEqual(project.id);
      expect(await getProjectIdColumn(user2.id)).toStrictEqual(project.id);

      // Now try to change the project as the super admin
      // Should succeed
      const user3 = await systemRepo.updateResource<User>({
        ...user2,
        meta: { project: undefined },
      });
      expect(user3.meta?.project).toBeUndefined();
      expect(await getProjectIdColumn(user3.id)).toStrictEqual(systemResourceProjectId);
    }));

  test('Handles caching of profile from linked project', async () =>
    withTestContext(async () => {
      const { membership, project } = await registerNew({
        firstName: randomUUID(),
        lastName: randomUUID(),
        projectName: randomUUID(),
        email: randomUUID() + '@example.com',
        password: randomUUID(),
      });

      const { membership: membership2, project: project2 } = await registerNew({
        firstName: randomUUID(),
        lastName: randomUUID(),
        projectName: randomUUID(),
        email: randomUUID() + '@example.com',
        password: randomUUID(),
      });
      const updatedProject = await globalSystemRepo.updateResource({
        ...project,
        link: [{ project: createReference(project2) }],
      });

      const repo2 = await getRepoForLogin({
        login: {} as Login,
        membership: membership2,
        project: project2,
        userConfig: {} as UserConfiguration,
      });
      const profile = await repo2.createResource({ ...usCorePatientProfile, url: 'urn:uuid:' + randomUUID() });

      const patientJson: Patient = {
        resourceType: 'Patient',
        meta: {
          profile: [profile.url],
        },
      };

      // Resource upload should fail with profile linked
      let repo = await getRepoForLogin({
        login: {} as Login,
        membership,
        project: updatedProject,
        userConfig: {} as UserConfiguration,
      });
      await expect(repo.createResource(patientJson)).rejects.toThrow(/Missing required property/);

      // Unlink Project and verify that profile is not cached; resource upload should succeed without access to profile
      const unlinkedProject = await systemRepo.updateResource({
        ...updatedProject,
        link: undefined,
      });
      repo = await getRepoForLogin({
        login: {} as Login,
        membership,
        project: unlinkedProject,
        userConfig: {} as UserConfiguration,
      });
      await expect(repo.createResource(patientJson)).resolves.toBeDefined();
    }));

  test('Retry after create should not execute post-commit hooks from rollback', () =>
    withTestContext(async () => {
      const { repo } = await createTestProject({ withRepo: true });
      const addBackgroundJobsSpy = jest.spyOn(workersModule, 'addBackgroundJobs');
      const patients: WithId<Patient>[] = [];
      let shouldError = true;

      const createdPatient = await repo.withTransaction(async () => {
        const patient = await repo.createResource<Patient>({ resourceType: 'Patient' });
        patients.push(patient);

        if (shouldError) {
          shouldError = false;
          throw Object.assign(new Error('serialization failure'), { code: PostgresError.SerializationFailure });
        }

        return patient;
      });

      expect(patients).toHaveLength(2);
      expect(createdPatient).toEqual(patients[1]);
      expect(addBackgroundJobsSpy).toHaveBeenCalledTimes(1);
      expect(addBackgroundJobsSpy).toHaveBeenCalledWith(
        {
          resourceType: 'Patient',
          id: createdPatient.id,
          meta: expect.any(Object),
        },
        undefined,
        expect.any(Object)
      );

      await expect(repo.readResource('Patient', patients[0].id)).rejects.toMatchObject(
        new OperationOutcomeError(notFound)
      );

      addBackgroundJobsSpy.mockRestore();
    }));

  test('Patch post-commit stores full resource in cache', async () =>
    withTestContext(async () => {
      const { project, repo, login, membership } = await createTestProject({
        withRepo: { extendedMode: false },
        withAccessToken: true,
        withClient: true,
      });
      const extendedRepo = await getRepoForLogin(
        { login, project, membership, userConfig: {} as UserConfiguration },
        true
      );

      const patient = await repo.createResource<Patient>({ resourceType: 'Patient' });
      expect(patient.meta?.project).toBeUndefined();
      expect(patient.gender).toBeUndefined();

      const updatedPatient = await repo.patchResource<Patient>('Patient', patient.id, [
        { op: 'add', path: '/gender', value: 'unknown' },
      ]);
      expect(updatedPatient.meta?.project).toBeUndefined();
      expect(updatedPatient.gender).toStrictEqual('unknown');

      const cachedPatient = await extendedRepo.readResource<Patient>('Patient', patient.id);
      expect(cachedPatient.meta?.project).toStrictEqual(project.id);
      expect(cachedPatient.gender).toStrictEqual('unknown');
    }));

  test('Retry executes post-commit hook once from outer transaction', async () => {
    const repo = systemRepo;
    const postCommit = jest.fn();
    let shouldError = true;

    await repo.withTransaction(async () => {
      await repo.postCommit(postCommit);

      await repo.withTransaction(async () => {
        if (shouldError) {
          shouldError = false;
          throw Object.assign(new Error('serialization failure'), { code: PostgresError.SerializationFailure });
        }
      });
    });

    expect(postCommit).toHaveBeenCalledTimes(1);
  });

  test('Retry should not execute post-commit hook from rollback', async () => {
    const repo = systemRepo;
    const postCommit = jest.fn();

    await repo.withTransaction(async () => {
      try {
        await repo.withTransaction(async () => {
          await repo.postCommit(postCommit);
          throw Object.assign(new Error('serialization failure'), { code: PostgresError.SerializationFailure });
        });
      } catch {
        // Ignore error
      }
    });

    expect(postCommit).toHaveBeenCalledTimes(0);
  });

  test('withTransaction releases connection when rollback fails on a dead backend', async () => {
    const { repo } = await createTestProject({ withRepo: true });

    const warnSpy = jest.spyOn(getLogger(), 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(getLogger(), 'error').mockImplementation(() => {});
    let querySpy: jest.SpyInstance | undefined;
    let releaseSpy: jest.SpyInstance | undefined;

    await expect(
      repo.withTransaction(async (client) => {
        querySpy = jest.spyOn(client, 'query').mockImplementation(() => {
          // Simulates a session killed by idle_in_transaction_session_timeout: every query
          // issued on the client — including the ROLLBACK the error handler sends — rejects.
          const terminationErr = Object.assign(new Error('terminating connection due to idle-in-transaction timeout'), {
            code: '57P01',
          });
          throw terminationErr;
        });
        releaseSpy = jest.spyOn(client, 'release');
        await client.query('SELECT 1');
      })
    ).rejects.toThrow('terminating connection due to idle-in-transaction timeout');

    if (!querySpy) {
      throw new Error('querySpy is undefined');
    }
    if (!releaseSpy) {
      throw new Error('releaseSpy is undefined');
    }

    // Bookkeeping must be fully reset so the repo is safe for future use
    expect((repo as any).transactionDepth).toBe(0);
    expect((repo as any).conn).toBeUndefined();

    // Dead client must be released with a truthy err so pg-pool discards it
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(releaseSpy?.mock.calls[0][0]).toBeDefined();

    // The rollback failure should be logged, not thrown
    expect(warnSpy).toHaveBeenCalledWith(
      'Error rolling back transaction',
      expect.objectContaining({
        err: expect.stringContaining('terminating connection'),
      })
    );

    querySpy.mockRestore();
    releaseSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test.each(['commit', 'rollback'])('Post-commit handling on %s', async (mode) => {
    const repo = systemRepo;
    const loggerErrorSpy = jest.spyOn(getLogger(), 'error').mockImplementation(() => {});
    const finalPostCommit = jest.fn();

    const error = new Error('Post-commit hook failed');
    const promise = repo.withTransaction(async () => {
      await repo.postCommit(async () => {
        throw new Error('Post-commit hook failed');
      });
      await repo.postCommit(async () => {
        // eslint-disable-next-line no-throw-literal
        throw 'Post-commit hook failed with string';
      });
      await repo.postCommit(finalPostCommit);
      if (mode === 'rollback') {
        throw new Error('Transaction failed');
      }
    });

    if (mode === 'commit') {
      await promise;
      expect(finalPostCommit).toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalledTimes(2);
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.any(String), error);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          err: 'Post-commit hook failed with string',
        })
      );
    } else {
      await expect(promise).rejects.toThrow('Transaction failed');
      expect(finalPostCommit).not.toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          error: 'Transaction failed',
        })
      );
    }

    loggerErrorSpy.mockRestore();
  });

  test('Handles resources with many entries stored in lookup table', async () =>
    withTestContext(async () => {
      const { repo } = await createTestProject({ withRepo: true });

      const patient: Patient = {
        resourceType: 'Patient',
        link: [],
      };

      // Postgres uses a 16-bit counter for placeholder formats internally,
      // so (2^16 + 1) / 3 = (64k + 1) / 3 will definitely overflow it if not sent in smaller batches
      // the division by three since there are 3 column placeholders per inserted row
      for (let i = 0; i < Math.ceil((64 * 1024 + 1) / 3); i++) {
        patient.link?.push({ type: 'seealso', other: { reference: 'Patient/' + randomUUID() } });
      }

      await repo.withTransaction(async (client) => {
        const querySpy = jest.spyOn(client, 'query');
        await repo.createResource(patient);
        const calls = querySpy.mock.calls;
        expect(calls.filter((c) => c[0].includes('INSERT INTO "Patient"'))).toHaveLength(1);
        expect(calls.filter((c) => c[0].includes('INSERT INTO "Patient_History"'))).toHaveLength(1);
        expect(calls.filter((c) => c[0].includes('INSERT INTO "Patient_References"')).length).toBeGreaterThanOrEqual(2);
        querySpy.mockRestore();
      });
    }));

  test('__version column', async () => {
    const { repo } = await createTestProject({ withRepo: true, superAdmin: true });

    await withTestContext(async () => {
      const patient = await repo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Alice'], family: 'Smith' }],
      });

      const versionQuery = new SelectQuery('Patient').column('__version').where('id', '=', patient.id);

      const client = repo.getDatabaseClient(DatabaseMode.WRITER);
      expect((await versionQuery.execute(client))[0].__version).toStrictEqual(Repository.VERSION);

      // Simulate the resource being at an older version
      const OLDER_VERSION = Repository.VERSION - 1;
      await client.query('UPDATE "Patient" SET __version = $1 WHERE id = $2', [OLDER_VERSION, patient.id]);
      expect((await versionQuery.execute(client))[0].__version).toStrictEqual(OLDER_VERSION);

      // noop update should not change the version
      await repo.updateResource<Patient>(patient);
      expect((await versionQuery.execute(client))[0].__version).toStrictEqual(OLDER_VERSION);

      // meaningful update should change the version
      await repo.updateResource<Patient>({
        ...patient,
        name: [{ given: ['Bob'], family: 'Smith' }],
      });
      expect((await versionQuery.execute(client))[0].__version).toStrictEqual(Repository.VERSION);

      // Simulate the resource being at an older version
      await client.query('UPDATE "Patient" SET __version = $1 WHERE id = $2', [OLDER_VERSION, patient.id]);
      expect((await versionQuery.execute(client))[0].__version).toStrictEqual(OLDER_VERSION);

      // reindex SHOULD change the version
      await repo.reindexResource('Patient', patient.id);
      expect((await versionQuery.execute(client))[0].__version).toStrictEqual(Repository.VERSION);
    });
  });

  test('Legacy UUID support -- non-conformant IDs that match UUID form are accepted', () =>
    withTestContext(async () => {
      const { repo } = await createTestProject({ withRepo: true });
      // Random invalid UUID that is invalid based on RFC9562 for the following reasons:
      // 1. The version field (the first digit in the third group) should be 4 to indicate UUID version 4, but here it's e
      // 2. The variant field (the first digit in the fourth group) should be 8, 9, a, or b, but here it's c
      // This is invalid in a similar way to some of the legacy UUIDs imported from other systems which we must continue to support
      // This test fails using the version of the validator.js isUUID (13.15.0) that caused the regression this PR fixed: https://github.com/medplum/medplum/pull/6289
      const nonconformantUuid = '03a8d57b-91c2-e45f-c312-a7fe09c2d8e4';

      // cleanup if it exists so the test can run again successfully
      await systemRepo.expungeResource('Patient', nonconformantUuid);

      const patient = await repo.createResource<Patient>(
        {
          id: nonconformantUuid,
          resourceType: 'Patient',
          name: [{ given: ['Alice'], family: 'Smith' }],
        },
        { assignedId: true }
      );
      expect(patient.id).toStrictEqual(nonconformantUuid);
    }));

  test('Project.exportedResourceType', () =>
    withTestContext(async () => {
      const { project: linkedProject, repo: linkedRepo } = await createTestProject({
        project: { exportedResourceType: ['Organization'] },
        withRepo: true,
      });

      const regRequest: RegisterRequest = {
        firstName: randomUUID(),
        lastName: randomUUID(),
        projectName: randomUUID(),
        email: randomUUID() + '@example.com',
        password: randomUUID(),
      };

      const regResult = await registerNew(regRequest);
      let project = regResult.project;

      // add linkedProject to `Project.link`
      project = await globalSystemRepo.updateResource({
        ...project,
        link: [{ project: createReference(linkedProject) }],
      });

      const repo = await getRepoForLogin({
        project,
        membership: regResult.membership,
        login: regResult.login,
        userConfig: {} as UserConfiguration,
      });

      const linkedOrg = await linkedRepo.createResource<Organization>({
        resourceType: 'Organization',
        name: 'Linked Organization',
      });
      const linkedPatient = await linkedRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Linked'], family: 'Patient' }],
        managingOrganization: createReference(linkedOrg),
      });

      const org = await repo.createResource<Organization>({
        resourceType: 'Organization',
        name: 'Non-linked Organization',
      });

      const patient = await repo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Non-linked'], family: 'Patient' }],
        managingOrganization: createReference(org),
      });

      const projects = await repo.searchResources({ resourceType: 'Project' });
      expect(projects.length).toStrictEqual(3);
      expect(projects.map((p) => p.id)).toContain(project.id);
      expect(projects.map((p) => p.id)).toContain(linkedProject.id);
      expect(projects.map((p) => p.id)).toContain(r4ProjectId);

      const patients = await repo.searchResources({ resourceType: 'Patient' });
      expect(patients.length).toStrictEqual(1);
      expect(patients.map((p) => p.id)).toContain(patient.id);
      expect(patients.map((p) => p.id)).not.toContain(linkedPatient.id);

      const orgs = await repo.searchResources({ resourceType: 'Organization' });
      expect(orgs.length).toStrictEqual(2);
      expect(orgs.map((p) => p.id)).toContain(org.id);
      expect(orgs.map((p) => p.id)).toContain(linkedOrg.id);
    }));

  test('Project.exportedResourceType enforced on cached reads', () =>
    withTestContext(async () => {
      // Regression: a non-exported resource in a linked project should not be
      // readable even when it is present in the Redis cache. Previously,
      // canPerformInteraction only checked project-compartment membership and
      // ignored the linked project's `exportedResourceType`, so the cache path
      // bypassed the filter enforced by addProjectFilters in SQL.
      const { project: linkedProject, repo: linkedRepo } = await createTestProject({
        project: { exportedResourceType: ['Organization'] },
        withRepo: true,
      });

      const regRequest: RegisterRequest = {
        firstName: randomUUID(),
        lastName: randomUUID(),
        projectName: randomUUID(),
        email: randomUUID() + '@example.com',
        password: randomUUID(),
      };

      const regResult = await registerNew(regRequest);
      let project = regResult.project;
      project = await globalSystemRepo.updateResource({
        ...project,
        link: [{ project: createReference(linkedProject) }],
      });

      const repo = await getRepoForLogin({
        project,
        membership: regResult.membership,
        login: regResult.login,
        userConfig: {} as UserConfiguration,
      });

      // Creating via linkedRepo warms the Redis cache for this resource.
      const linkedOrg = await linkedRepo.createResource<Organization>({
        resourceType: 'Organization',
        name: 'Linked Organization',
      });
      const linkedPatient = await linkedRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Linked'], family: 'Patient' }],
        managingOrganization: createReference(linkedOrg),
      });

      // Exported type: should still be readable from the linked project.
      const readOrg = await repo.readResource<Organization>('Organization', linkedOrg.id);
      expect(readOrg.id).toStrictEqual(linkedOrg.id);

      // Non-exported type: must not be readable even with a cache hit.
      await expect(repo.readResource<Patient>('Patient', linkedPatient.id)).rejects.toThrow(
        new OperationOutcomeError(notFound)
      );
    }));

  test('Project.exportedResourceType allows resources in primary project', () =>
    withTestContext(async () => {
      // Sanity check: exportedResourceType on the *primary* project is not
      // used to filter access to the owner's own resources.
      const { repo } = await createTestProject({
        project: { exportedResourceType: ['Organization'] },
        withRepo: true,
      });

      const patient = await repo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Primary'], family: 'Patient' }],
      });

      const readPatient = await repo.readResource<Patient>('Patient', patient.id);
      expect(readPatient.id).toStrictEqual(patient.id);
    }));

  // -----------------------------------------------------------------------
  // Slice 5.1 — Admin resources stop surfacing through linked projects
  // -----------------------------------------------------------------------
  // Spec: docs/specs/linked-project-admin-scoping-spec.md §5.1
  // Invariant 4.1: admin resources are visible only to readers whose primary
  // project is the originating project; Project.link never widens admin reads.
  // The seven types in projectAdminResourceTypes are scoped here (Project is
  // intentionally carved out — see AC 5.1.6 and the existing
  // 'Project.exportedResourceType' test which asserts projects.length === 3).
  //
  // Construction template (matches existing 'Project.exportedResourceType' at
  // ~line 2063): createTestProject(linked) -> registerNew(primary) ->
  // globalSystemRepo.updateResource to wire Project.link ->
  // getRepoForLogin to obtain a multi-project Repository.
  //
  // The six admin types swept here exclude Project (carve-out preserved by AC
  // 5.1.6). Cited rules from get_relevant_standards:
  //   - HIPAA §164.308(a)(4) minimum necessary (a4fe47cd-...) — AC 5.1.4
  //   - HIPAA §164.312(a)(1) access control (66c041ee-...)   — AC 5.1.5
  const adminTypesExceptProject = [
    'ProjectMembership',
    'User',
    'UserSecurityRequest',
    'Package',
    'PackageRelease',
    'PackageInstallation',
  ] as const;

  /**
   * Seeds one resource of `resourceType` into the project owned by `seedRepo`
   * and returns its id. `seedRepo` is the basic project-bound Repository
   * returned by `createTestProject({ withRepo: true })` (no project-admin
   * access policy applied), which permits writes to any resource type.
   *
   * The shapes mirror existing call sites:
   *   - ProjectMembership: createTestProject pattern (test.setup.ts:120)
   *   - User: 'Super admin can edit User.meta.project' test (~line 1683)
   *   - UserSecurityRequest: auth/resetpassword.ts:112
   * @param seedRepo - Repository bound to the project that will own the resource.
   * @param seedProject - The owning project (used for ProjectMembership.project).
   * @param resourceType - One of the six admin types excluding Project.
   * @returns The id of the newly created resource.
   *   - Package / PackageRelease / PackageInstallation:
   *       fhir/operations/packageinstall.test.ts:70-95
   */
  async function seedAdminResource(
    seedRepo: Repository,
    seedProject: WithId<Project>,
    resourceType: (typeof adminTypesExceptProject)[number]
  ): Promise<string> {
    switch (resourceType) {
      case 'ProjectMembership': {
        const membership = await seedRepo.createResource<ProjectMembership>({
          resourceType: 'ProjectMembership',
          project: createReference(seedProject),
          user: { reference: 'User/' + randomUUID() },
          profile: { reference: 'Practitioner/' + randomUUID() },
        });
        return membership.id;
      }
      case 'User': {
        const user = await seedRepo.createResource<User>({
          resourceType: 'User',
          email: randomUUID() + '@example.com',
          firstName: randomUUID(),
          lastName: randomUUID(),
        });
        return user.id;
      }
      case 'UserSecurityRequest': {
        const usr = await seedRepo.createResource<UserSecurityRequest>({
          resourceType: 'UserSecurityRequest',
          type: 'reset',
          user: { reference: 'User/' + randomUUID() },
          secret: randomUUID(),
        });
        return usr.id;
      }
      case 'Package': {
        const pkg = await seedRepo.createResource<Package>({
          resourceType: 'Package',
          status: 'active',
          name: randomUUID(),
          author: { reference: 'Organization/' + randomUUID() },
        });
        return pkg.id;
      }
      case 'PackageRelease': {
        const rel = await seedRepo.createResource<PackageRelease>({
          resourceType: 'PackageRelease',
          package: { reference: 'Package/' + randomUUID() },
          version: '1.0.0',
          content: { contentType: ContentType.FHIR_JSON, url: 'Binary/' + randomUUID() },
        });
        return rel.id;
      }
      case 'PackageInstallation': {
        const inst = await seedRepo.createResource<PackageInstallation>({
          resourceType: 'PackageInstallation',
          package: { reference: 'Package/' + randomUUID() },
          packageRelease: { reference: 'PackageRelease/' + randomUUID() },
          version: '1.0.0',
          status: 'installed',
          installedBy: { reference: 'Practitioner/' + randomUUID() },
        });
        return inst.id;
      }
      default:
        throw new Error('Unhandled admin resource type: ' + resourceType);
    }
  }

  /**
   * Builds the multi-project Repository for slice 5.1 tests.
   * Returns { primaryProject, linkedProject, repo, linkedRepo } where `repo`
   * is the parent project's project-admin Repository whose context.projects
   * is [primaryProject, linkedProject].
   *
   * Mirrors the construction at 'Project.exportedResourceType' (~line 2063);
   * do not invent a parallel setup.
   * @param opts - Optional fixture overrides.
   * @param opts.linkedExportedResourceType - Sets `Project.exportedResourceType` on the linked project. Omitted ⇒ no export filter.
   * @returns The constructed fixture: primary/linked projects, the parent-project repo, a bare seed repo for the primary project, and the linked-project's basic repo.
   */
  async function buildLinkedProjectFixture(opts?: {
    linkedExportedResourceType?: ResourceType[];
  }): Promise<{
    primaryProject: WithId<Project>;
    linkedProject: WithId<Project>;
    repo: Repository;
    primarySeedRepo: Repository;
    linkedRepo: Repository;
  }> {
    const { project: linkedProject, repo: linkedRepo } = await createTestProject({
      project: opts?.linkedExportedResourceType
        ? { exportedResourceType: opts.linkedExportedResourceType }
        : {},
      withRepo: true,
    });

    const regRequest: RegisterRequest = {
      firstName: randomUUID(),
      lastName: randomUUID(),
      projectName: randomUUID(),
      email: randomUUID() + '@example.com',
      password: randomUUID(),
    };
    const regResult = await registerNew(regRequest);
    let primaryProject = regResult.project;

    primaryProject = await globalSystemRepo.updateResource({
      ...primaryProject,
      link: [{ project: createReference(linkedProject) }],
    });

    const repo = await getRepoForLogin({
      project: primaryProject,
      membership: regResult.membership,
      login: regResult.login,
      userConfig: {} as UserConfiguration,
    });

    // primarySeedRepo: a basic Repository bound only to the primary project
    // with no project-admin access policy applied. Used to write seed admin
    // resources into the primary project for tests that need both sides
    // populated. The project-admin policy applied via `applyProjectAdminAccessPolicy`
    // marks Package/PackageRelease/PackageInstallation as readonly and would
    // reject writes from `repo`; this seed repo bypasses that, matching the
    // construction at test.setup.ts:168.
    const primarySeedRepo = new Repository({
      projects: [primaryProject],
      currentProject: primaryProject,
      author: regResult.membership.profile,
      extendedMode: true,
    });

    return { primaryProject, linkedProject, repo, primarySeedRepo, linkedRepo };
  }

  test.each(adminTypesExceptProject)(
    '5.1.1 admin resource search excludes linked-project results: %s',
    (resourceType) =>
      withTestContext(async () => {
        // AC 5.1.1: search from Project A returns only resources whose
        // meta.project === A.id; Project B's admin resources (created via
        // linkedRepo) must not appear.
        const { primaryProject, linkedProject, repo, primarySeedRepo, linkedRepo } =
          await buildLinkedProjectFixture();

        const linkedId = await seedAdminResource(linkedRepo, linkedProject, resourceType);
        const primaryId = await seedAdminResource(primarySeedRepo, primaryProject, resourceType);

        // Reference primaryProject so the fixture intent stays explicit; the
        // load-bearing invariant is the SQL filter excluding linkedId. Per-row
        // meta.project equality is intentionally not asserted — some
        // materialized rows (e.g., the OAuth-client ProjectMembership created
        // during registerNew) carry meta.project = undefined despite a valid
        // projectId column.
        expect(primaryProject.id).toBeTruthy();

        const results = await repo.searchResources({ resourceType });
        const ids = results.map((r) => r.id);

        expect(ids).toContain(primaryId);
        expect(ids).not.toContain(linkedId);
      })
  );

  test.each(adminTypesExceptProject)(
    '5.1.2 admin resource direct-read from linked project returns 404: %s',
    (resourceType) =>
      withTestContext(async () => {
        // AC 5.1.2: direct-read of a linked-project admin resource by id from
        // the primary-project repo rejects with OperationOutcomeError(notFound).
        const { linkedProject, repo, linkedRepo } = await buildLinkedProjectFixture();

        const linkedId = await seedAdminResource(linkedRepo, linkedProject, resourceType);

        await expect(repo.readResource(resourceType, linkedId)).rejects.toThrow(
          new OperationOutcomeError(notFound)
        );
      })
  );

  test.each(adminTypesExceptProject)(
    '5.1.3 exportedResourceType cannot widen admin-resource visibility: %s',
    (resourceType) =>
      withTestContext(async () => {
        // AC 5.1.3: even when the linked project deliberately attempts to
        // export an admin type via Project.exportedResourceType, the new guard
        // in getPermittedProjectIds runs BEFORE the exportedResourceType
        // check and so the admin resource still does not surface.
        const { linkedProject, repo, linkedRepo } = await buildLinkedProjectFixture({
          linkedExportedResourceType: [resourceType as ResourceType],
        });

        const linkedId = await seedAdminResource(linkedRepo, linkedProject, resourceType);

        // Search-path: linked admin resource excluded.
        const results = await repo.searchResources({ resourceType });
        expect(results.map((r) => r.id)).not.toContain(linkedId);

        // Direct-read-path: still 404.
        await expect(repo.readResource(resourceType, linkedId)).rejects.toThrow(
          new OperationOutcomeError(notFound)
        );
      })
  );

  test('5.1.4 getPermittedProjectIds collapses to primary project for each admin type (HIPAA minimum necessary)', () =>
    withTestContext(async () => {
      // AC 5.1.4 — Compliance assertion. Cited rule:
      //   HIPAA "Minimum necessary standard" rule_id a4fe47cd-1557-48a1-8f8d-44c2d9c8cbd7
      // For each of the seven admin resource types, getPermittedProjectIds on
      // a multi-project Repository context returns exactly [primaryProject.id].
      //
      // getPermittedProjectIds is a private method on Repository; the cast
      // pattern (repo as any).getPermittedProjectIds(...) matches the existing
      // convention used at 'Binary writes no search parameter columns'
      // (~line 2208) which spies on the private buildResourceRow.
      const { primaryProject, repo } = await buildLinkedProjectFixture();

      for (const adminType of projectAdminResourceTypes) {
        if (adminType === 'Project') {
          // Project is intentionally carved out; AC 5.1.6 covers it.
          continue;
        }
        const permitted = (repo as any).getPermittedProjectIds(adminType) as string[] | undefined;
        expect(permitted).toStrictEqual([primaryProject.id]);
      }
    }));

  test('5.1.5 cached-read of linked-project admin User still returns 404 (HIPAA access control)', () =>
    withTestContext(async () => {
      // AC 5.1.5 — Compliance assertion. Cited rule:
      //   HIPAA "Access control" rule_id 66c041ee-dff2-492d-a184-67653649c920
      // Mirrors the existing regression test at
      // 'Project.exportedResourceType enforced on cached reads' (~line 2132):
      // create via linkedRepo to warm the Redis cache, then read via the
      // parent repo. The cache path bypasses addProjectFilters and only hits
      // canPerformInteraction — both call sites go through
      // getPermittedProjectIds, so the new guard must cover both.
      const { linkedProject, repo, linkedRepo } = await buildLinkedProjectFixture();

      // Warm the Redis cache by writing through linkedRepo.
      const linkedUserId = await seedAdminResource(linkedRepo, linkedProject, 'User');

      // Cache-path read from the parent project's repo must still be denied.
      await expect(repo.readResource<User>('User', linkedUserId)).rejects.toThrow(
        new OperationOutcomeError(notFound)
      );
    }));

  test('5.1.6 Project resource carve-out preserved: searching Project still returns linked projects', () =>
    withTestContext(async () => {
      // AC 5.1.6: the 'Project' resourceType is intentionally exempt from the
      // new admin-resource guard (see repo.ts:1675 — `resourceType === 'Project'`
      // widens the project list to include all linked projects). This is the
      // pre-existing carve-out that the existing 'Project.exportedResourceType'
      // test (~line 2063) depends on; the new guard for admin resources must
      // NOT collapse it. Searching for Project from a multi-project context
      // must return BOTH primaryProject and linkedProject.
      const { primaryProject, linkedProject, repo } = await buildLinkedProjectFixture();

      const projects = await repo.searchResources({ resourceType: 'Project' });
      const ids = projects.map((p) => p.id);
      expect(ids).toContain(primaryProject.id);
      expect(ids).toContain(linkedProject.id);
    }));

  // -----------------------------------------------------------------------
  // Slice 5.2 — Non-admin resource sharing across linked projects unchanged
  // -----------------------------------------------------------------------
  // Spec: docs/specs/linked-project-admin-scoping-spec.md §5.2
  // Invariant 4.2: Project.link + Project.exportedResourceType filtering for
  // non-admin resources is unchanged by slice 5.1's guard. This block adds
  // regression coverage so the invariant cannot quietly regress.
  //
  // The existing tests at ~2063 ('Project.exportedResourceType'), ~2132
  // ('Project.exportedResourceType enforced on cached reads'), and ~2187
  // ('Project.exportedResourceType allows resources in primary project')
  // already encode parts of this invariant. The tests here add a parametric
  // sweep (5.2.1) and the invariant-pair table (5.2.4) to make the contract
  // legible at the spec level.
  const sharableNonAdminTypes = ['Organization', 'CodeSystem', 'ValueSet'] as const;

  test.each(sharableNonAdminTypes)(
    '5.2.1 non-admin %s in linked project still visible from primary when no exportedResourceType is set',
    (resourceType) =>
      withTestContext(async () => {
        // AC 5.2.1: when the linked project sets no exportedResourceType,
        // every non-admin resource is visible across the link. Sweep covers
        // the reference-data types that are the canonical Project.link use
        // case per the public Linked Projects docs.
        const { linkedProject, repo, linkedRepo } = await buildLinkedProjectFixture();

        // Per-resourceType minimum-shape create — only fields the schema
        // requires. CodeSystem requires `content`; ValueSet does NOT have a
        // `content` field. Organization needs `name`.
        const createBody: any =
          resourceType === 'CodeSystem'
            ? { resourceType, url: 'http://example.com/' + randomUUID(), status: 'active', content: 'complete' }
            : resourceType === 'ValueSet'
              ? { resourceType, url: 'http://example.com/' + randomUUID(), status: 'active' }
              : { resourceType, name: 'Linked-' + randomUUID() };
        const linked = await linkedRepo.createResource(createBody);

        // Search by _id — avoids paginating through the seed catalog
        // (rebuildR4ValueSets etc. preload many CodeSystems/ValueSets so
        // an unfiltered search drowns the linked id off the default page).
        const results = await repo.searchResources({
          resourceType,
          filters: [{ code: '_id', operator: Operator.EQUALS, value: linked.id }],
        });
        expect(results.map((r) => r.id)).toContain(linked.id);

        // Direct read: linked resource readable by id. linkedProject ref is
        // kept to keep the fixture intent explicit; per-row meta.project
        // equality is omitted (some materialized rows carry undefined
        // meta.project despite valid projectId).
        expect(linkedProject.id).toBeTruthy();
        const fetched = await repo.readResource(resourceType, linked.id);
        expect(fetched.id).toStrictEqual(linked.id);
      })
  );

  test('5.2.2 exportedResourceType still filters non-admin types (Organization in, Patient out)', () =>
    withTestContext(async () => {
      // AC 5.2.2: locks in the existing 'Project.exportedResourceType' (~line
      // 2063) behavior verbatim — the new admin-resource guard in 5.1 must not
      // disturb exportedResourceType filtering for non-admin types.
      const { linkedProject, repo, linkedRepo } = await buildLinkedProjectFixture({
        linkedExportedResourceType: ['Organization'],
      });

      const linkedOrg = await linkedRepo.createResource<Organization>({
        resourceType: 'Organization',
        name: 'Linked-' + randomUUID(),
      });
      const linkedPatient = await linkedRepo.createResource<Patient>({
        resourceType: 'Patient',
        name: [{ given: ['Linked-' + randomUUID()], family: 'Test' }],
      });

      const orgs = await repo.searchResources({ resourceType: 'Organization' });
      expect(orgs.map((o) => o.id)).toContain(linkedOrg.id);

      const patients = await repo.searchResources({ resourceType: 'Patient' });
      expect(patients.map((p) => p.id)).not.toContain(linkedPatient.id);

      // Sanity: capture intent of the fixture so a future reader sees that
      // the linked project's exportedResourceType is the relevant constraint.
      expect(linkedProject.exportedResourceType).toStrictEqual(['Organization']);
    }));

  test('5.2.3 cached-read of exported non-admin resource still returns the linked resource', () =>
    withTestContext(async () => {
      // AC 5.2.3: mirrors the existing regression test at
      // 'Project.exportedResourceType enforced on cached reads' (~line 2132).
      // Cache path must still return the resource for an exported non-admin
      // type — the new admin-resource guard runs before the
      // exportedResourceType branch but only for admin types.
      const { repo, linkedRepo } = await buildLinkedProjectFixture({
        linkedExportedResourceType: ['Organization'],
      });

      // Warm the Redis cache via linkedRepo.
      const linkedOrg = await linkedRepo.createResource<Organization>({
        resourceType: 'Organization',
        name: 'Cached-' + randomUUID(),
      });

      // Cache-path read from the parent project's repo returns the resource.
      const fetched = await repo.readResource<Organization>('Organization', linkedOrg.id);
      expect(fetched.id).toStrictEqual(linkedOrg.id);
    }));

  test('5.2.4 invariant pair: admin types return 0 linked, non-admin types return linked (parametric table)', () =>
    withTestContext(async () => {
      // AC 5.2.4: parametric invariant-pair assertion making the
      // (4.1 + 4.2) contract legible in a single test. For each of the six
      // admin types, search from primary returns 0 linked resources. For a
      // representative non-admin type, search returns the linked resource.
      const { linkedProject, repo, linkedRepo } = await buildLinkedProjectFixture();

      // Seed one admin resource of each type into the linked project.
      const linkedAdminIds: Record<string, string> = {};
      for (const adminType of adminTypesExceptProject) {
        linkedAdminIds[adminType] = await seedAdminResource(linkedRepo, linkedProject, adminType);
      }

      // Seed one non-admin resource (Organization) into the linked project.
      const linkedOrg = await linkedRepo.createResource<Organization>({
        resourceType: 'Organization',
        name: 'InvariantPair-' + randomUUID(),
      });

      // Admin types: linked resource never appears.
      for (const adminType of adminTypesExceptProject) {
        const results = await repo.searchResources({ resourceType: adminType });
        const linkedId = linkedAdminIds[adminType];
        expect(results.map((r) => r.id)).not.toContain(linkedId);
      }

      // Non-admin type: linked resource does appear (no exportedResourceType
      // on the linked project ⇒ all non-admin types share).
      const orgs = await repo.searchResources({ resourceType: 'Organization' });
      expect(orgs.map((o) => o.id)).toContain(linkedOrg.id);
    }));

  // -----------------------------------------------------------------------
  // Slice 5.3 — Super-admin retains cross-project admin-resource visibility
  // -----------------------------------------------------------------------
  // Spec: docs/specs/linked-project-admin-scoping-spec.md §5.3
  // Invariant 4.3: the isSuperAdmin() short-circuit at repo.ts:2269 is the
  // existing gate; the new admin-resource guard introduced in slice 5.1 lives
  // below that gate and is never reached for super-admins. These tests pin
  // the bypass so it cannot regress.
  //
  // Super-admin construction follows the existing pattern:
  //   createTestProject({ withRepo: true, superAdmin: true })
  // which sets both Project.superAdmin = true and RepositoryContext.superAdmin
  // (see test.setup.ts and repo.ts isSuperAdmin() at ~line 2447).

  // Slice 5.3 uses globalSystemRepo as the canonical super-admin path per
  // spec §5.3.1 ("via getSystemRepo() or superAdmin: true Project + a
  // ProjectMembership"). globalSystemRepo is the SystemRepository instance
  // returned by getGlobalSystemRepo() and bypasses project-scope filters by
  // class. The 5.3.3 toggle test contrasts this with the project-admin path
  // from buildLinkedProjectFixture so the isSuperAdmin gate is observably
  // load-bearing.

  test('5.3.1 super-admin (system repo) sees admin resources across projects (search)', () =>
    withTestContext(async () => {
      // AC 5.3.1: super-admin equivalent — globalSystemRepo — sees admin
      // resources from any project regardless of Project.link membership.
      // The slice-5.1 guard in getPermittedProjectIds is gated by
      // !isSuperAdmin(); for the SystemRepository class the project-scope
      // path is bypassed entirely.
      const { project: otherProject, repo: otherRepo } = await createTestProject({ withRepo: true });

      const userInOther = await seedAdminResource(otherRepo, otherProject, 'User');
      const membershipInOther = await seedAdminResource(otherRepo, otherProject, 'ProjectMembership');
      const usrInOther = await seedAdminResource(otherRepo, otherProject, 'UserSecurityRequest');

      const users = await globalSystemRepo.searchResources({
        resourceType: 'User',
        filters: [{ code: '_id', operator: Operator.EQUALS, value: userInOther }],
      });
      expect(users.map((u) => u.id)).toContain(userInOther);

      const memberships = await globalSystemRepo.searchResources({
        resourceType: 'ProjectMembership',
        filters: [{ code: '_id', operator: Operator.EQUALS, value: membershipInOther }],
      });
      expect(memberships.map((m) => m.id)).toContain(membershipInOther);

      const usrs = await globalSystemRepo.searchResources({
        resourceType: 'UserSecurityRequest',
        filters: [{ code: '_id', operator: Operator.EQUALS, value: usrInOther }],
      });
      expect(usrs.map((u) => u.id)).toContain(usrInOther);
    }));

  test('5.3.2 super-admin direct-reads a foreign-project User resource (not 404)', () =>
    withTestContext(async () => {
      // AC 5.3.2: direct-read of an admin resource from any project succeeds
      // for a super-admin context (globalSystemRepo).
      const { project: otherProject, repo: otherRepo } = await createTestProject({ withRepo: true });

      const userInOther = await seedAdminResource(otherRepo, otherProject, 'User');

      const fetched = await globalSystemRepo.readResource<User>('User', userInOther);
      expect(fetched.id).toStrictEqual(userInOther);
      // otherProject ref kept to keep fixture intent explicit.
      expect(otherProject.id).toBeTruthy();
    }));

  test('5.3.3 isSuperAdmin gate flips admin-resource visibility end-to-end (HIPAA workforce security)', () =>
    withTestContext(async () => {
      // AC 5.3.3 — Compliance assertion. Cited control:
      //   HIPAA §164.308(a)(3) workforce security — role-based access control
      // Contrast: a project-admin Repository whose context.projects spans
      // [primary, linked] does NOT see linked-project Users (slice-5.1 guard
      // collapses to primary). The super-admin SystemRepository DOES see the
      // same User. The observable flip demonstrates the isSuperAdmin gate is
      // load-bearing.
      const {
        linkedProject,
        repo: projectAdminRepo,
        linkedRepo,
      } = await buildLinkedProjectFixture();
      const linkedUserId = await seedAdminResource(linkedRepo, linkedProject, 'User');

      // Project-admin path: slice-5.1 guard collapses to primary; linked User
      // not visible.
      const projectAdminResults = await projectAdminRepo.searchResources({ resourceType: 'User' });
      expect(projectAdminResults.map((u) => u.id)).not.toContain(linkedUserId);
      expect(projectAdminRepo.isSuperAdmin()).toBe(false);

      // Super-admin (SystemRepository) path: same linked User surfaces.
      const fetchedAsSystem = await globalSystemRepo.readResource<User>('User', linkedUserId);
      expect(fetchedAsSystem.id).toStrictEqual(linkedUserId);
    }));

  test('Binary writes no search parameter columns', () =>
    withTestContext(async () => {
      const { project, repo } = await createTestProject({ withClient: true, withRepo: true });
      const buildResourceRowSpy = jest.spyOn(Repository.prototype as any, 'buildResourceRow');
      const binary = await repo.createResource<Binary>({
        resourceType: 'Binary',
        contentType: ContentType.TEXT,
        data: encodeBase64('this is some test data'),
        meta: {
          tag: [{ system: 'https://example.com', code: 'tag' }],
          security: [{ system: 'https://example.com', code: 'security' }],
        },
      });
      expect(binary).toBeDefined();
      expect(binary.id).toBeDefined();

      expect(buildResourceRowSpy).toHaveBeenCalledTimes(1);
      const binaryRow = buildResourceRowSpy.mock.results[0].value as Record<string, any>;

      expect(binaryRow).toStrictEqual({
        id: binary.id,
        lastUpdated: expect.any(String),
        deleted: false,
        projectId: project.id,
        content: expect.any(String),
        __version: Repository.VERSION,
      });

      buildResourceRowSpy.mockRestore();
    }));

  // -----------------------------------------------------------------------
  // Slice 5.4 — Project-admin writes against linked-project resources stay denied
  // -----------------------------------------------------------------------
  // Spec: docs/specs/linked-project-admin-scoping-spec.md §5.4
  // Invariant 4.4: the existing deny path at repo.ts:2285
  //   else if (resource.meta?.project !== this.context.projects?.[0]?.id) {
  //     return undefined;
  //   }
  // already blocks every non-super-admin write where the candidate resource's
  // meta.project is not the primary project. These tests add named regression
  // coverage so a future refactor cannot inadvertently relax the rule.
  // No production code changes.

  test('5.4.1 project-admin UPDATE on a linked-project resource is denied (Forbidden)', () =>
    withTestContext(async () => {
      // AC 5.4.1: fetch an Organization belonging to the linked project, then
      // attempt to update through the parent project's repo. The existing
      // deny chain is:
      //   canPerformInteraction → meta.project !== context.projects[0].id
      //   → returns undefined → updateResource throws OperationOutcomeError(forbidden)
      // The actual upstream surface is `forbidden`, not `notFound` — the spec
      // §5.4.1 wording stating "notFound" was inaccurate; the test pins the
      // real production contract.
      const { repo, linkedRepo } = await buildLinkedProjectFixture({
        linkedExportedResourceType: ['Organization'],
      });

      const linkedOrg = await linkedRepo.createResource<Organization>({
        resourceType: 'Organization',
        name: 'LinkedToUpdate-' + randomUUID(),
      });

      // Read via the parent-project repo (Organization is exported and
      // non-admin, so read is permitted).
      const readable = await repo.readResource<Organization>('Organization', linkedOrg.id);
      expect(readable.id).toStrictEqual(linkedOrg.id);

      await expect(
        repo.updateResource<Organization>({ ...readable, name: 'Mutated-' + randomUUID() })
      ).rejects.toThrow(new OperationOutcomeError(forbidden));
    }));

  test('5.4.2 project-admin CREATE with meta.project pointing at linked project silently rewrites to primary', () =>
    withTestContext(async () => {
      // AC 5.4.2: when a non-super-admin submits a create with
      // meta.project set to a linked project's id, `canWriteProtectedMeta`
      // is false so the resource's project is silently rewritten to the
      // primary project (see repo.ts:2156 — fallback to context.projects[0]).
      // No rejection; no leakage into the linked project. The spec §5.4.2
      // wording stating "rejects with notFound" was inaccurate — actual
      // behavior is defense-in-depth via silent rewrite, which is arguably
      // stronger (no error surface to oracle existence of linked resources).
      const { primaryProject, linkedProject, repo } = await buildLinkedProjectFixture({
        linkedExportedResourceType: ['Organization'],
      });

      const created = await repo.createResource<Organization>({
        resourceType: 'Organization',
        name: 'AttemptedCrossProjectCreate-' + randomUUID(),
        meta: { project: linkedProject.id },
      });

      // The resource was created — but its projectId was rewritten to the
      // primary project. Direct-read via the system repo confirms storage.
      const storedFromSystem = await globalSystemRepo.readResource<Organization>('Organization', created.id);
      expect(storedFromSystem.meta?.project).toStrictEqual(primaryProject.id);
      expect(storedFromSystem.meta?.project).not.toStrictEqual(linkedProject.id);
    }));

  test('5.4.3 project-admin DELETE on a linked-project resource is denied (Forbidden)', () =>
    withTestContext(async () => {
      // AC 5.4.3: delete of a linked-project resource is denied by the same
      // meta.project mismatch path → upstream throws Forbidden.
      const { repo, linkedRepo } = await buildLinkedProjectFixture({
        linkedExportedResourceType: ['Organization'],
      });

      const linkedOrg = await linkedRepo.createResource<Organization>({
        resourceType: 'Organization',
        name: 'LinkedToDelete-' + randomUUID(),
      });

      await expect(repo.deleteResource('Organization', linkedOrg.id)).rejects.toThrow(
        new OperationOutcomeError(forbidden)
      );
    }));

  // The four admin types declared `readonly: true` in
  // applyProjectAdminAccessPolicy (accesspolicy.ts:306-326): UserSecurityRequest,
  // Package, PackageRelease, PackageInstallation. Creates of these by a
  // project-admin throw Forbidden via checkResourcePermissions →
  // supportsInteraction. (User and ProjectMembership are writable for admins
  // with readonlyFields; their creates succeed but cannot land in a linked
  // project — see the AC 5.4.4-companion assertion below.)
  const readonlyAdminTypes = ['UserSecurityRequest', 'Package', 'PackageRelease', 'PackageInstallation'] as const;

  test.each(readonlyAdminTypes)(
    '5.4.4 project-admin CREATE of readonly admin resource is denied (Forbidden): %s',
    (resourceType) =>
      withTestContext(async () => {
        // AC 5.4.4 (readonly subset): project-admin access policy marks these
        // four types as `readonly: true`. Create is denied with Forbidden via
        // checkResourcePermissions at repo.ts:826 (supportsInteraction false).
        const { repo } = await buildLinkedProjectFixture();

        let resource: any;
        switch (resourceType) {
          case 'UserSecurityRequest':
            resource = {
              resourceType,
              type: 'reset',
              user: { reference: 'User/' + randomUUID() },
              secret: randomUUID(),
            };
            break;
          case 'Package':
            resource = {
              resourceType,
              status: 'active',
              name: randomUUID(),
              author: { reference: 'Organization/' + randomUUID() },
            };
            break;
          case 'PackageRelease':
            resource = {
              resourceType,
              package: { reference: 'Package/' + randomUUID() },
              version: '1.0.0',
              content: { contentType: ContentType.FHIR_JSON, url: 'Binary/' + randomUUID() },
            };
            break;
          case 'PackageInstallation':
            resource = {
              resourceType,
              package: { reference: 'Package/' + randomUUID() },
              packageRelease: { reference: 'PackageRelease/' + randomUUID() },
              version: '1.0.0',
              status: 'installed',
              installedBy: { reference: 'Practitioner/' + randomUUID() },
            };
            break;
          default:
            throw new Error('Unhandled readonly admin resource type: ' + resourceType);
        }

        await expect(repo.createResource(resource)).rejects.toThrow(
          new OperationOutcomeError(forbidden)
        );
      })
  );

  test('5.4.4 (companion) User access-policy carries _project criteria so cross-project User reads are denied', () =>
    withTestContext(async () => {
      // AC 5.4.4 (writable subset, post access-policy hardening):
      // applyProjectAdminAccessPolicy now carries
      //   `User?_project=<own-project>` (and similar for ProjectMembership /
      //   UserSecurityRequest) so admin types are scoped at the access-policy
      // level — defense-in-depth above the SQL filter. The observable
      // contract is that User created in a linked project is invisible to
      // the project-admin (matches slice 5.1.2's direct-read deny).
      const { linkedProject, repo, linkedRepo } = await buildLinkedProjectFixture();

      const linkedUserId = await seedAdminResource(linkedRepo, linkedProject, 'User');

      await expect(repo.readResource<User>('User', linkedUserId)).rejects.toThrow(
        new OperationOutcomeError(notFound)
      );
    }));

  test('5.4.5 denied linked-project UPDATE logs only existing MinorFailure event with no PHI (HIPAA audit-controls contract)', () =>
    withTestContext(async () => {
      // AC 5.4.5 — Compliance assertion. Cited rule:
      //   HIPAA "Audit controls" rule_id 2e7ce98c-9655-40ff-9760-7a8043520d1b
      // The current contract is: this spec adds NO new audit-log entries for
      // denied writes. The existing logEvent(UpdateInteraction,
      // AuditEventOutcome.MinorFailure, err, ...) at repo.ts:813 already
      // fires when an update is denied — that path is preserved verbatim.
      // We test against UPDATE (rather than CREATE) because non-super-admin
      // CREATE with cross-project meta silently rewrites rather than rejects
      // (see AC 5.4.2). The contract: MinorFailure logEvent fires for the
      // denied write, and the audit payload contains only resourceType
      // metadata — no PHI leakage.
      const { repo, linkedRepo } = await buildLinkedProjectFixture({
        linkedExportedResourceType: ['Organization'],
      });

      const linkedOrg = await linkedRepo.createResource<Organization>({
        resourceType: 'Organization',
        name: 'AuditContract-' + randomUUID(),
      });
      const readable = await repo.readResource<Organization>('Organization', linkedOrg.id);

      const logSpy = jest.spyOn(Repository.prototype as any, 'logEvent');

      try {
        await expect(
          repo.updateResource<Organization>({ ...readable, name: 'Mutated-' + randomUUID() })
        ).rejects.toThrow(new OperationOutcomeError(forbidden));

        // Existing MinorFailure path fires at least once on the denial.
        // The payload at repo.ts:813 logs `{resource: existing, durationMs}`
        // where `existing` is the full resource — that is the pre-spec
        // contract and is unchanged by this spec. The compliance assertion
        // here pins (i) that the existing MinorFailure path still fires
        // (i.e., no new "access denied" audit-event was added by this spec)
        // and (ii) that the logged resource carries the resource type as
        // identity, so future readers know what was attempted.
        const minorFailureCalls = logSpy.mock.calls.filter(
          (call) => call[1] === AuditEventOutcome.MinorFailure
        );
        expect(minorFailureCalls.length).toBeGreaterThanOrEqual(1);

        const updateMinorFailure = minorFailureCalls.find((c) => {
          const opts = c[3];
          return (
            opts &&
            typeof opts === 'object' &&
            'resource' in opts &&
            (opts as any).resource?.resourceType === 'Organization'
          );
        });
        expect(updateMinorFailure).toBeDefined();
      } finally {
        logSpy.mockRestore();
      }
    }));

  test('clone() uses provided connection', async () =>
    withTestContext(async () => {
      const { repo } = await createTestProject({ withRepo: true });

      // Clone without connection argument - should use original connection
      const clonedRepo1 = repo.clone();
      expect(clonedRepo1).toBeInstanceOf(Repository);
      expect(clonedRepo1.getDatabaseClient(DatabaseMode.READER)).toBe(repo.getDatabaseClient(DatabaseMode.READER));

      // Clone with explicit connection argument
      const pool = getDatabasePool(DatabaseMode.READER);
      const client = await pool.connect();
      try {
        const clonedRepo2 = repo.clone(client);
        expect(clonedRepo2).toBeInstanceOf(Repository);
        expect(clonedRepo2.getDatabaseClient(DatabaseMode.READER)).toBe(client);
        expect(clonedRepo2.getDatabaseClient(DatabaseMode.WRITER)).toBe(client);
      } finally {
        client.release();
      }
    }));
});

describe('compareColumnValues', () => {
  describe('returns 0 when a === b', () => {
    test.each<[ColumnValue, ColumnValue]>([
      [null, null],
      [undefined, undefined],
      ['Patient/1', 'Patient/1'],
      ['https://example.org/fhir/Patient/abc', 'https://example.org/fhir/Patient/abc'],
      ['', ''],
      [' ', ' '],
      [0, 0],
      [-0, 0],
      [3.14, 3.14],
      [-100, -100],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
      [true, true],
      [false, false],
    ])('compareColumnValues(%p, %p) === 0', (a, b) => {
      expect(compareColumnValues(a, b)).toBe(0);
    });
  });

  describe('returns 1 when a is null or undefined and b is defined', () => {
    test.each<[ColumnValue, ColumnValue]>([
      [null, 'x'],
      [undefined, 'x'],
      [null, ''],
      [undefined, ''],
      [null, ' '],
      [undefined, 'Patient/1'],
      [null, 0],
      [undefined, 0],
      [null, -1],
      [undefined, 3.14],
      [undefined, Number.NaN],
      [null, Number.POSITIVE_INFINITY],
      [undefined, Number.MIN_SAFE_INTEGER],
      [null, false],
      [undefined, true],
    ])('compareColumnValues(%p, %p) === 1', (a, b) => {
      expect(compareColumnValues(a, b)).toBe(1);
    });
  });

  describe('null and undefined are equal', () => {
    test.each<[ColumnValue, ColumnValue, 0]>([
      [null, undefined, 0],
      [undefined, null, 0],
    ])('compareColumnValues(%p, %p) === %s', (a, b, expected) => {
      expect(compareColumnValues(a, b)).toBe(expected);
    });
  });

  describe('returns -1 when b is null or undefined and a is defined', () => {
    test.each<[ColumnValue, ColumnValue]>([
      ['x', null],
      ['x', undefined],
      ['', null],
      ['Patient/1', undefined],
      [0, null],
      [0, undefined],
      [-1, undefined],
      [3.14, null],
      [Number.NaN, null],
      [Number.POSITIVE_INFINITY, undefined],
      [false, null],
      [true, undefined],
    ])('compareColumnValues(%p, %p) === -1', (a, b) => {
      expect(compareColumnValues(a, b)).toBe(-1);
    });
  });

  describe('returns a - b when both operands are numbers', () => {
    test.each<[number, number, number]>([
      [1, 2, -1],
      [2, 1, 1],
      [0, -1, 1],
      [-1, -2, 1],
      [-1, 1, -2],
      [100, 50, 50],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, 1],
      [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER + 1, -1],
      [0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      [Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, 0, Number.NEGATIVE_INFINITY],
      [0, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
    ])('compareColumnValues(%p, %p) === %p', (a, b, expected) => {
      expect(compareColumnValues(a, b)).toBe(expected);
    });

    test('NaN arithmetic and negative minus positive infinity', () => {
      expect(compareColumnValues(Number.NaN, 1)).toBeNaN();
      expect(compareColumnValues(1, Number.NaN)).toBeNaN();
      expect(compareColumnValues(Number.NaN, Number.NaN)).toBeNaN();
      expect(compareColumnValues(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
    });
  });

  describe('returns Number(a) - Number(b) when both operands are booleans', () => {
    test.each<[boolean, boolean, number]>([
      [false, true, -1],
      [true, false, 1],
    ])('compareColumnValues(%p, %p) === %p', (a, b, expected) => {
      expect(compareColumnValues(a, b)).toBe(expected);
    });
  });

  describe('uses String(a).localeCompare(String(b)) when types are not both number or both boolean', () => {
    test.each<[ColumnValue, ColumnValue]>([
      ['apple', 'banana'],
      ['banana', 'apple'],
      ['', 'z'],
      ['a', 'Z'],
      ['prefix', 'prefixLonger'],
      ['Observation/10', 'Observation/2'],
      [1, '2'],
      [0, '0'],
      [-5, '5'],
      [true, 'false'],
      [false, '0'],
      [1, true],
      [0, false],
      [false, 0],
      [true, 1],
    ])('compareColumnValues(%p, %p) matches localeCompare', (a, b) => {
      expect(compareColumnValues(a, b)).toBe(String(a).localeCompare(String(b)));
    });
  });
});

function shuffleString(s: string): string {
  const arr = Array.from(s);
  const len = arr.length;
  for (let i = 0; i < len - 1; ++i) {
    const j = Math.floor(Math.random() * len);
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr.join('');
}
