import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('form_dataset', Path(__file__).resolve().parents[1] / 'scripts/form_dataset.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class FormDatasetTests(unittest.TestCase):
    def test_manifest_is_unique_and_only_selected_side_view_exercises(self):
        rows = module.manifest_rows(Path(__file__).resolve().parents[1] / 'scripts/mendeley-side-manifest.csv')
        self.assertEqual(len(rows), 32)
        self.assertEqual(len({row['subject'] for row in rows}), 8)
        self.assertTrue(all(module.filename(row).endswith('_side.mp4') for row in rows))

    def test_segmentation_marks_unclosed_motion_uncertain(self):
        values = [155, 148, 129, 101, 89, 103, 129, 148, 158]
        samples = [{'at': index * 120, 'side': 'left', 'angle': value} for index, value in enumerate(values)]
        complete, uncertain = module.segment(samples, 'squat')
        self.assertEqual(len(complete), 1)
        self.assertEqual(uncertain, 0)
        incomplete, uncertain = module.segment(samples[:-3], 'squat')
        self.assertEqual(len(incomplete), 0)
        self.assertEqual(uncertain, 1)

    def test_occlusion_or_side_switch_cannot_create_repetition(self):
        values = [160, 130, 90, None, 130, 160]
        samples = [None if value is None else {'at': index * 120, 'side': 'left', 'angle': value}
                   for index, value in enumerate(values)]
        complete, uncertain = module.segment(samples, 'squat')
        self.assertEqual(len(complete), 0)
        self.assertGreater(uncertain, 0)


if __name__ == '__main__':
    unittest.main()
