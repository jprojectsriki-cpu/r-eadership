/**
 * R-eadership API - 入口
 * 画面（GitHub Pages）から { action: '○○', ... } の形のJSONを POST で受け取り、JSONで返す
 * ※ getSheet_ と SHEETS は Setup.gs のものを使う
 */

/** GETの入口（動いているかの確認用） */
function doGet() {
  return json_({ ok: true, message: 'R-eadership API is running' });
}

/** オブジェクトをJSONで返す */
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** POSTの入口 */
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, message: 'リクエストの形式が正しくありません。' });
  }

  try {
    switch (req.action) {
      case 'ping':
        return json_({ ok: true, school: getSchoolInfo_().name });
      case 'login':
        return json_(login_(req.schoolCode, req.teacherId, req.password));
      case 'logout':
        return json_(logout_(req.token));
      case 'me':
        return json_(checkSession_(req.token));
      case 'masters':
        return json_(listMasters_(req.token));
      case 'saveDepartment':
        return json_(saveDepartment_(req.token, req.item));
      case 'deleteDepartment':
        return json_(deleteDepartment_(req.token, req.id));
      case 'saveClass':
        return json_(saveClass_(req.token, req.item));
      case 'deleteClass':
        return json_(deleteClass_(req.token, req.code));
      case 'saveQualification':
        return json_(saveQualification_(req.token, req.item));
      case 'deleteQualification':
        return json_(deleteQualification_(req.token, req.id));
      case 'teachers':
        return json_(listTeachers_(req.token));
      case 'createTeacher':
        return json_(createTeacher_(req.token, req.item));
      case 'updateTeacher':
        return json_(updateTeacher_(req.token, req.item));
      case 'setTeacherStatus':
        return json_(setTeacherStatus_(req.token, req.teacherId, req.stop === true));
      case 'resetTeacherPassword':
        return json_(resetTeacherPassword_(req.token, req.teacherId));
      case 'changeMyPassword':
        return json_(changeMyPassword_(req.token, req.currentPassword, req.newPassword));
      case 'students':
        return json_(listStudents_(req.token));
      case 'studentLogs':
        return json_(studentLogs_(req.token, req.studentId));
      case 'saveStudent':
        return json_(saveStudent_(req.token, req.item));
      case 'deleteStudent':
        return json_(deleteStudent_(req.token, req.studentId));
      case 'importStudents':
        return json_(importStudents_(req.token, req.rows, req.dryRun === true));
      case 'moveStudent':
        return json_(moveStudent_(req.token, req.studentId, req.toClass, req.reason));
      case 'setEnrollStatus':
        return json_(setEnrollStatus_(req.token, req.studentId, req.status, req.reason));
      case 'updateStudentNotes':
        return json_(updateStudentNotes_(req.token, req.studentId, req.quals, req.memo));
      default:
        return json_({ ok: false, message: '不明な操作です。' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, message: 'エラーが発生しました。時間をおいてもう一度お試しください。' });
  }
}
